from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import os
import re
import sys
import warnings
import zipfile
from collections import defaultdict
from typing import Any


MAX_RAW_BYTES = 10 * 1024 * 1024
MAX_HTML_TRACKED = 512
MAX_PDF_PAGES = 1000
MAX_PDF_BLOCKS = 8192
MAX_SELECTORS = 16384
MAX_IMAGE_DESCRIPTION = 128000
MAX_IMAGE_DIMENSION = 8192
MAX_IMAGE_PIXELS = 25_000_000
MAX_ZIP_ENTRIES = 2048
MAX_ZIP_TOTAL_BYTES = 64 * 1024 * 1024
MAX_ZIP_MEMBER_BYTES = 16 * 1024 * 1024
MAX_ZIP_RATIO = 100
MAX_XML_ELEMENTS = {
    "docx": 250_000,
    "xlsx": 500_000,
    "pptx": 500_000,
}
MAX_DOCX_PARAGRAPHS = 8192
MAX_DOCX_CELLS = 16384
MAX_XLSX_ROWS = 50_000
MAX_XLSX_CELLS = 50_000
MAX_PPTX_SLIDES = 128
MAX_PPTX_SHAPES = 20_000
MAX_RELATIONSHIPS = 1024
MAX_SEGMENTS_PER_BLOCK = 128
MAX_SELECTORS_PER_SEGMENT = 4
MAX_SELECTORS_PER_BLOCK = 256
PPTX_SHAPE_ELEMENTS = {
    "sp",
    "pic",
    "graphicFrame",
    "cxnSp",
    "grpSp",
    "contentPart",
}


class ValidationOverflow(ValueError):
    pass


def _apply_process_limits() -> None:
    """Best-effort child containment; parser caps remain the portable boundary."""
    if os.name != "nt":
        try:
            import resource

            resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
        except (ImportError, OSError, ValueError):
            pass
        return
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
        JobObjectExtendedLimitInformation = 9

        class BasicLimitInformation(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_longlong),
                ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class IoCounters(ctypes.Structure):
            _fields_ = [("ReadOperationCount", ctypes.c_ulonglong), ("WriteOperationCount", ctypes.c_ulonglong), ("OtherOperationCount", ctypes.c_ulonglong), ("ReadTransferCount", ctypes.c_ulonglong), ("WriteTransferCount", ctypes.c_ulonglong), ("OtherTransferCount", ctypes.c_ulonglong)]

        class ExtendedLimitInformation(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", BasicLimitInformation),
                ("IoInfo", IoCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        handle = kernel32.CreateJobObjectW(None, None)
        if handle:
            limits = ExtendedLimitInformation()
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            limits.ProcessMemoryLimit = 768 * 1024 * 1024
            kernel32.SetInformationJobObject(handle, JobObjectExtendedLimitInformation, ctypes.byref(limits), ctypes.sizeof(limits))
            kernel32.AssignProcessToJobObject(handle, kernel32.GetCurrentProcess())
            globals()["_JOB_HANDLE"] = handle
    except (AttributeError, OSError, TypeError, ValueError):
        pass


def selector_css(value: str) -> dict[str, Any]:
    return {"type": "CssSelector", "value": value}


def _selector_key(selector: dict[str, Any]) -> str:
    return json.dumps(selector, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _dedupe_selectors(selectors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for selector in selectors:
        key = _selector_key(selector)
        if key in seen:
            continue
        seen.add(key)
        output.append(selector)
    return output


def block(
    text: object,
    selectors: list[dict[str, Any]],
    segments: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    value = " ".join(str(text).split())
    if not value:
        return None
    if segments is None:
        segments = [{"start": 0, "end": len(value), "selectors": selectors}]
    if len(segments) > MAX_SEGMENTS_PER_BLOCK:
        raise ValidationOverflow("VALIDATION_ERROR: physical segment budget exceeded")
    for segment in segments:
        if (
            not isinstance(segment.get("start"), int)
            or not isinstance(segment.get("end"), int)
            or segment["start"] < 0
            or segment["end"] <= segment["start"]
            or segment["end"] > len(value)
            or not isinstance(segment.get("selectors"), list)
            or len(segment["selectors"]) > MAX_SELECTORS_PER_SEGMENT
        ):
            raise ValidationOverflow("FORMAT_CORRUPT: invalid physical segment")
    flattened = _dedupe_selectors([selector for segment in segments for selector in segment["selectors"]])
    if len(flattened) > MAX_SELECTORS_PER_BLOCK:
        raise ValidationOverflow("VALIDATION_ERROR: block selector budget exceeded")
    return {"text": value, "selectors": flattened, "segments": segments}


def html_blocks(data: bytes) -> list[dict[str, Any]]:
    from bs4 import BeautifulSoup, Comment

    soup = BeautifulSoup(data.decode("utf-8"), "html.parser")
    for tag in soup.find_all(["script", "style", "noscript", "svg", "iframe", "canvas", "video", "audio", "object", "embed"]):
        tag.decompose()
    for comment in soup.find_all(string=lambda value: isinstance(value, Comment)):
        comment.extract()
    output: list[dict[str, Any]] = []
    tracked = soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "blockquote", "pre"])
    if len(tracked) > MAX_HTML_TRACKED:
        raise ValidationOverflow("VALIDATION_ERROR: HTML tracked element budget exceeded")

    ordinal_by_tag: dict[int, int] = {}

    def cache_ordinals(parent: Any) -> None:
        counts: dict[str, int] = defaultdict(int)
        for child in getattr(parent, "contents", []):
            if not getattr(child, "name", None):
                continue
            counts[child.name] += 1
            ordinal_by_tag[id(child)] = counts[child.name]
            cache_ordinals(child)

    cache_ordinals(soup)

    def css_path(tag: Any) -> str:
        parts: list[str] = []
        current = tag
        while getattr(current, "name", None) and current.name != "[document]":
            position = ordinal_by_tag.get(id(current))
            if position is None:
                raise ValueError("HTML ordinal cache missed a tracked element")
            parts.append(f"{current.name}:nth-of-type({position})")
            current = current.parent
        return " > ".join(reversed(parts))

    for tag in tracked:
        value = " ".join(tag.get_text(" ", strip=True).split())
        selector = css_path(tag)
        item = block(value, [selector_css(selector)])
        if item:
            output.append(item)
    if not output:
        item = block(" ".join(soup.get_text(" ", strip=True).split()), [selector_css("body")])
        if item:
            output.append(item)
    return output


def pdf_blocks(data: bytes) -> list[dict[str, Any]]:
    import pdfplumber

    if b"/Encrypt" in data:
        raise PermissionError("encrypted PDF")
    output: list[dict[str, Any]] = []
    with pdfplumber.open(io.BytesIO(data)) as document:
        if document.metadata.get("Encrypted") is True:
            raise PermissionError("encrypted PDF")
        if len(document.pages) > MAX_PDF_PAGES:
            raise ValidationOverflow("VALIDATION_ERROR: PDF page budget exceeded")
        for page_number, page in enumerate(document.pages, 1):
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            sorted_words = sorted(
                words,
                key=lambda value: (float(value["top"]), float(value["x0"]), value["text"]),
            )
            lines: list[list[dict[str, Any]]] = []
            for word in sorted_words:
                height = max(1.0, float(word["bottom"]) - float(word["top"]))
                target = next(
                    (
                        line
                        for line in reversed(lines)
                        if abs(float(word["top"]) - float(line[0]["top"])) <= max(2.0, height * 0.55)
                    ),
                    None,
                )
                if target is None:
                    lines.append([word])
                else:
                    target.append(word)
            normalized_lines = [
                sorted(line, key=lambda value: (float(value["x0"]), value["text"]))
                for line in sorted(lines, key=lambda value: (float(value[0]["top"]), float(value[0]["x0"])))
            ]
            if not normalized_lines:
                continue
            widths = [
                max(1.0, float(word["x1"]) - float(word["x0"]))
                for line in normalized_lines
                for word in line
            ]
            median_width = sorted(widths)[len(widths) // 2]
            gap_threshold = max(24.0, median_width * 3.0)
            boundary_candidates: list[float] = []
            for line in normalized_lines:
                for left, right in zip(line, line[1:]):
                    gap = float(right["x0"]) - float(left["x1"])
                    if gap >= gap_threshold:
                        boundary_candidates.append((float(left["x1"]) + float(right["x0"])) / 2.0)
            for left_index, left_line in enumerate(normalized_lines):
                left_x1 = float(left_line[-1]["x1"])
                left_top = min(float(value["top"]) for value in left_line)
                left_bottom = max(float(value["bottom"]) for value in left_line)
                for right_line in normalized_lines[left_index + 1 :]:
                    left_line_x0 = float(left_line[0]["x0"])
                    right_line_x0 = float(right_line[0]["x0"])
                    left_line_x1 = float(left_line[-1]["x1"])
                    right_line_x1 = float(right_line[-1]["x1"])
                    if left_line_x0 <= right_line_x0:
                        left_edge, right_edge = left_line_x1, right_line_x0
                    else:
                        left_edge, right_edge = right_line_x1, left_line_x0
                    right_top = min(float(value["top"]) for value in right_line)
                    right_bottom = max(float(value["bottom"]) for value in right_line)
                    vertical_overlap = min(left_bottom, right_bottom) - max(left_top, right_top)
                    if vertical_overlap <= 0:
                        continue
                    gap = right_edge - left_edge
                    if gap >= gap_threshold:
                        boundary_candidates.append((left_edge + right_edge) / 2.0)
            boundary_clusters: list[list[float]] = []
            for boundary in sorted(boundary_candidates):
                if not boundary_clusters or boundary - boundary_clusters[-1][-1] > 24.0:
                    boundary_clusters.append([boundary])
                else:
                    boundary_clusters[-1].append(boundary)
            boundaries = [sum(cluster) / len(cluster) for cluster in boundary_clusters if len(cluster) >= 2]
            boundaries = [
                boundary
                for boundary in boundaries
                if not any(
                    float(line[0]["x0"]) < boundary < float(line[-1]["x1"])
                    for line in normalized_lines
                )
            ]
            regions: dict[int, list[list[dict[str, Any]]]] = defaultdict(list)
            for line in normalized_lines:
                center = (float(line[0]["x0"]) + float(line[-1]["x1"])) / 2.0
                region = sum(center > boundary for boundary in boundaries)
                regions[region].append(line)
            for region_number in sorted(regions):
                semantic_paragraph: list[list[list[dict[str, Any]]]] = []
                for line in regions[region_number]:
                    if not semantic_paragraph:
                        semantic_paragraph.append([line])
                        continue
                    previous = semantic_paragraph[-1]
                    previous_line = previous[-1]
                    previous_bottom = max(float(value["bottom"]) for value in previous_line)
                    current_top = min(float(value["top"]) for value in line)
                    line_height = max(1.0, max(float(value["bottom"]) - float(value["top"]) for value in line))
                    if current_top - previous_bottom > max(4.0, line_height * 1.8):
                        semantic_paragraph.append([line])
                    else:
                        previous.append(line)
                for paragraph_lines in semantic_paragraph:
                    words_in_paragraph = [value for line in paragraph_lines for value in line]
                    line_texts = [" ".join(str(value["text"]) for value in line) for line in paragraph_lines]
                    text = " ".join(line_texts)
                    segments: list[dict[str, Any]] = []
                    block_offset = 0
                    for line in paragraph_lines:
                        line_text = " ".join(str(value["text"]) for value in line)
                        line_selectors = [
                            {"type": "PageSelector", "page": page_number},
                            {
                                "type": "BoundingBoxSelector",
                                "page": page_number,
                                "x": float(min(value["x0"] for value in line)),
                                "y": float(min(value["top"] for value in line)),
                                "width": float(max(value["x1"] for value in line) - min(value["x0"] for value in line)),
                                "height": float(max(value["bottom"] for value in line) - min(value["top"] for value in line)),
                                "unit": "pt",
                            },
                        ]
                        segments.append(
                            {
                                "start": block_offset,
                                "end": block_offset + len(line_text),
                                "selectors": line_selectors,
                            }
                        )
                        block_offset += len(line_text) + 1
                    item = block(text, [], segments)
                    if item:
                        output.append(item)
                        if len(output) > MAX_PDF_BLOCKS:
                            raise ValidationOverflow("VALIDATION_ERROR: PDF block budget exceeded")
    return output


def _xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _safe_zip_name(name: str) -> None:
    normalized = name.replace("\\", "/")
    if not normalized or "\x00" in normalized or normalized.startswith("/"):
        raise ValidationOverflow("FORMAT_CORRUPT: unsafe OOXML member path")
    if re.match(r"^[A-Za-z]:/", normalized) or any(part == ".." for part in normalized.split("/")):
        raise ValidationOverflow("FORMAT_CORRUPT: unsafe OOXML member path")


def safe_ooxml_preflight(data: bytes, media_type: str) -> None:
    import xml.etree.ElementTree as element_tree

    package = {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    }[media_type]
    counts = defaultdict(int)
    seen_names: set[str] = set()
    actual_total = 0
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ZIP_ENTRIES:
                raise ValidationOverflow("VALIDATION_ERROR: OOXML member count exceeded")
            for info in infos:
                _safe_zip_name(info.filename)
                if info.filename in seen_names:
                    raise ValidationOverflow("FORMAT_CORRUPT: duplicate OOXML member path")
                seen_names.add(info.filename)
                if info.flag_bits & 0x1:
                    raise PermissionError("encrypted OOXML member")
                if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise ValidationOverflow("FORMAT_CORRUPT: unsupported OOXML compression")
                if info.is_dir():
                    continue
                if info.file_size > MAX_ZIP_MEMBER_BYTES:
                    raise ValidationOverflow("VALIDATION_ERROR: OOXML member size exceeded")
                if info.file_size and not info.compress_size:
                    raise ValidationOverflow("FORMAT_CORRUPT: invalid OOXML compression metadata")
                if info.compress_size and info.file_size / info.compress_size > MAX_ZIP_RATIO:
                    raise ValidationOverflow("VALIDATION_ERROR: OOXML compression ratio exceeded")
                if info.filename.lower().endswith(".rels"):
                    counts["relationships"] += 1
                if "/media/" in info.filename.lower():
                    counts["media"] += 1
                member = io.BytesIO()
                with archive.open(info, "r") as source:
                    while True:
                        chunk = source.read(64 * 1024)
                        if not chunk:
                            break
                        actual_total += len(chunk)
                        if len(chunk) + member.tell() > MAX_ZIP_MEMBER_BYTES or actual_total > MAX_ZIP_TOTAL_BYTES:
                            raise ValidationOverflow("VALIDATION_ERROR: OOXML decompression budget exceeded")
                        member.write(chunk)
                if info.filename.lower().endswith((".xml", ".rels")):
                    try:
                        element_count = 0
                        package_bytes = member.getvalue()
                        for _, node in element_tree.iterparse(io.BytesIO(package_bytes), events=("start",)):
                            element_count += 1
                            if element_count > MAX_XML_ELEMENTS[package]:
                                raise ValidationOverflow("VALIDATION_ERROR: OOXML XML element budget exceeded")
                            local = _xml_local_name(node.tag)
                            if package == "docx" and local == "p":
                                counts["paragraphs"] += 1
                            if package == "docx" and local == "tc":
                                counts["cells"] += 1
                            if package == "xlsx" and local == "row":
                                counts["rows"] += 1
                            if package == "xlsx" and local == "c":
                                counts["cells"] += 1
                            if package == "xlsx" and local == "sheet":
                                counts["worksheets"] += 1
                            if package == "pptx" and local == "sld":
                                counts["slides"] += 1
                            if package == "pptx" and local in PPTX_SHAPE_ELEMENTS:
                                counts["shapes"] += 1
                    except element_tree.ParseError as error:
                        raise ValidationOverflow("FORMAT_CORRUPT: invalid OOXML XML member") from error
            if counts["relationships"] > MAX_RELATIONSHIPS or counts["media"] > MAX_RELATIONSHIPS:
                raise ValidationOverflow("VALIDATION_ERROR: OOXML relationship/media budget exceeded")
    except zipfile.BadZipFile as error:
        raise ValidationOverflow("FORMAT_CORRUPT: invalid OOXML archive") from error
    if package == "docx" and (counts["paragraphs"] > MAX_DOCX_PARAGRAPHS or counts["cells"] > MAX_DOCX_CELLS):
        raise ValidationOverflow("VALIDATION_ERROR: DOCX parser object budget exceeded")
    if package == "xlsx" and (counts["rows"] > MAX_XLSX_ROWS or counts["cells"] > MAX_XLSX_CELLS):
        raise ValidationOverflow("VALIDATION_ERROR: XLSX parser object budget exceeded")
    if package == "pptx" and (counts["slides"] > MAX_PPTX_SLIDES or counts["shapes"] > MAX_PPTX_SHAPES):
        raise ValidationOverflow("VALIDATION_ERROR: PPTX parser object budget exceeded")


def image_preflight(data: bytes, media_type: str, expected_content_hash: str | None) -> dict[str, Any]:
    from PIL import Image, ImageFile

    digest = f"sha256:{hashlib.sha256(data).hexdigest()}"
    if expected_content_hash and digest != expected_content_hash:
        raise ValidationOverflow("FORMAT_CORRUPT: image content hash mismatch")
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                expected_format = "PNG" if media_type == "image/png" else "JPEG"
                if image.format != expected_format:
                    raise ValidationOverflow("FORMAT_CORRUPT: image media type does not match bytes")
                width, height = image.size
                image.verify()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValidationOverflow("FORMAT_CORRUPT: image pixel budget exceeded") from error
    except (OSError, ValueError) as error:
        raise ValidationOverflow("FORMAT_CORRUPT: image bytes could not be verified") from error
    pixels = width * height
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION or pixels > MAX_IMAGE_PIXELS:
        raise ValidationOverflow("VALIDATION_ERROR: image dimensions exceed the safety budget")
    return {"status": "IMAGE_PREFLIGHT", "format": expected_format, "width": width, "height": height, "pixels": pixels, "contentHash": digest}


def docx_blocks(data: bytes) -> list[dict[str, Any]]:
    from docx import Document

    document = Document(io.BytesIO(data))
    output: list[dict[str, Any]] = []
    for index, paragraph in enumerate(document.paragraphs, 1):
        item = block(paragraph.text, [selector_css(f"word/paragraph[{index}]")])
        if item:
            output.append(item)
    for table_index, table in enumerate(document.tables, 1):
        for row_index, row in enumerate(table.rows, 1):
            for column_index, cell in enumerate(row.cells, 1):
                item = block(
                    cell.text,
                    [
                        {
                            "type": "CellSelector",
                            "sheet": f"table-{table_index}",
                            "cell": f"R{row_index}C{column_index}",
                            "row": row_index,
                            "column": column_index,
                        }
                    ],
                )
                if item:
                    output.append(item)
    return output


def xlsx_blocks(data: bytes) -> list[dict[str, Any]]:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=False)
    output: list[dict[str, Any]] = []
    for sheet in workbook.worksheets:
        # Read-only worksheets may trust an adversarial or stale declared
        # dimension. Recalculate the bounds from the worksheet XML before
        # iterating so sparse sheets cannot amplify into XFD-sized scans.
        reset_dimensions = getattr(sheet, "reset_dimensions", None)
        if callable(reset_dimensions):
            reset_dimensions()
        for row in sheet.iter_rows():
            for cell_value in row:
                if cell_value.value is None:
                    continue
                item = block(
                    cell_value.value,
                    [
                        {
                            "type": "CellSelector",
                            "sheet": sheet.title,
                            "cell": cell_value.coordinate,
                            "row": cell_value.row,
                            "column": cell_value.column,
                        }
                    ],
                )
                if item:
                    output.append(item)
    workbook.close()
    return output


def csv_blocks(data: bytes) -> list[dict[str, Any]]:
    from openpyxl.utils import get_column_letter

    output: list[dict[str, Any]] = []
    for row_number, row in enumerate(csv.reader(io.StringIO(data.decode("utf-8"))), 1):
        for column_number, value in enumerate(row, 1):
            item = block(
                value,
                [
                    {
                        "type": "CellSelector",
                        "sheet": "CSV",
                        "cell": f"{get_column_letter(column_number)}{row_number}",
                        "row": row_number,
                        "column": column_number,
                    }
                ],
            )
            if item:
                output.append(item)
    return output


def pptx_blocks(data: bytes) -> list[dict[str, Any]]:
    from pptx import Presentation

    presentation = Presentation(io.BytesIO(data))
    output: list[dict[str, Any]] = []
    for slide_number, slide in enumerate(presentation.slides, 1):
        for shape in slide.shapes:
            text_value = getattr(shape, "text", "")
            item = block(
                text_value,
                [
                    {"type": "ShapeSelector", "slide": slide_number, "shapeId": str(shape.shape_id)},
                    {
                        "type": "BoundingBoxSelector",
                        "page": slide_number,
                        "x": float(shape.left / 12700),
                        "y": float(shape.top / 12700),
                        "width": float(shape.width / 12700),
                        "height": float(shape.height / 12700),
                        "unit": "pt",
                    },
                ],
            )
            if item:
                output.append(item)
    return output


def image_blocks(data: bytes, media_type: str, description: str | None, expected_content_hash: str | None) -> list[dict[str, Any]]:
    info = image_preflight(data, media_type, expected_content_hash)
    width = int(info["width"])
    height = int(info["height"])
    if not description:
        raise RuntimeError("MULTIMODAL_VALIDATION_REQUIRED")
    if len(description) > MAX_IMAGE_DESCRIPTION:
        raise ValidationOverflow("VALIDATION_ERROR: image description budget exceeded")
    item = block(
        description,
        [{"type": "BoundingBoxSelector", "x": 0, "y": 0, "width": width, "height": height, "unit": "px"}],
    )
    return [item] if item else []


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    _apply_process_limits()
    request = json.load(sys.stdin)
    data = base64.b64decode(request["contentBase64"], validate=True)
    if len(data) > MAX_RAW_BYTES:
        raise ValidationOverflow("VALIDATION_ERROR: raw document budget exceeded")
    media_type = request["mediaType"]
    operation = request.get("operation", "extract")
    if operation == "image-preflight":
        if media_type not in {"image/png", "image/jpeg"}:
            raise NotImplementedError("image preflight requires a PNG or JPEG")
        json.dump(image_preflight(data, media_type, request.get("expectedContentHash")), sys.stdout)
        return
    if media_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }:
        safe_ooxml_preflight(data, media_type)
    handlers = {
        "text/html": lambda: html_blocks(data),
        "application/pdf": lambda: pdf_blocks(data),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": lambda: docx_blocks(data),
        "text/csv": lambda: csv_blocks(data),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": lambda: xlsx_blocks(data),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": lambda: pptx_blocks(data),
        "image/png": lambda: image_blocks(data, media_type, request.get("imageDescription"), request.get("expectedContentHash")),
        "image/jpeg": lambda: image_blocks(data, media_type, request.get("imageDescription"), request.get("expectedContentHash")),
    }
    if media_type not in handlers:
        raise NotImplementedError(media_type)
    blocks = handlers[media_type]()
    if not blocks:
        raise ValueError("document contains no accessible text")
    if sum(len(item.get("selectors", [])) for item in blocks) > MAX_SELECTORS:
        raise ValidationOverflow("VALIDATION_ERROR: selector budget exceeded")
    json.dump({"status": "OK", "blocks": blocks}, sys.stdout, ensure_ascii=False)


try:
    main()
except NotImplementedError as error:
    json.dump({"status": "FORMAT_UNSUPPORTED", "message": str(error)}, sys.stdout)
except PermissionError as error:
    json.dump({"status": "FORMAT_ENCRYPTED", "message": str(error)}, sys.stdout)
except RuntimeError as error:
    status = str(error) if str(error) == "MULTIMODAL_VALIDATION_REQUIRED" else "FORMAT_CORRUPT"
    json.dump({"status": status, "message": str(error)}, sys.stdout)
except ValidationOverflow as error:
    status = "FORMAT_CORRUPT" if str(error).startswith("FORMAT_CORRUPT:") else "VALIDATION_ERROR"
    json.dump({"status": status, "message": str(error)}, sys.stdout)
except Exception as error:
    message = str(error)
    lowered = f"{error.__class__.__name__} {message}".lower()
    status = "FORMAT_ENCRYPTED" if "password" in lowered or "encrypted" in lowered else "FORMAT_CORRUPT"
    json.dump({"status": status, "message": message or error.__class__.__name__}, sys.stdout)
