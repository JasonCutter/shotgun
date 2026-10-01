from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import math
import os
import re
import sys
import warnings
import zipfile
from collections import Counter, defaultdict
from typing import Any


MAX_RAW_BYTES = 10 * 1024 * 1024
MAX_HTML_TRACKED = 512
MAX_PDF_PAGES = 1000
MAX_PDFIUM_PAGE_CHARS = 100_000
MAX_PDFIUM_TEXT_ROWS = 20_000
MAX_PDF_BLOCKS = 8192
MAX_CSV_BLOCKS = 8192
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
    # PDF font maps (and some other source formats) can yield U+0000 for an
    # unmapped glyph. PostgreSQL text/jsonb cannot store NUL; replacing one
    # code point with one visible marker preserves physical segment offsets.
    value = " ".join(str(text).split()).replace("\x00", "\ufffd")
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


def pdfium_page_glyphs(pdfium_page: Any) -> list[dict[str, Any]]:
    """Return bounded PDFium character boxes in pdfplumber's top-origin coordinates."""
    text_page = pdfium_page.get_textpage()
    try:
        if text_page.count_chars() > MAX_PDFIUM_PAGE_CHARS:
            return []
        text = text_page.get_text_range()
        page_height = float(pdfium_page.get_height())
        output: list[dict[str, Any]] = []
        for index, value in enumerate(text):
            try:
                x0, y0, x1, y1 = (float(part) for part in text_page.get_charbox(index))
            except Exception:
                continue
            if not all(math.isfinite(part) for part in (x0, y0, x1, y1)):
                continue
            top, bottom = page_height - y1, page_height - y0
            # Whitespace often has a zero-area PDFium box; retain it as a
            # positional hint while rejecting malformed visible glyphs.
            if not value.isspace() and (x1 <= x0 or bottom <= top):
                continue
            output.append(
                {
                    "index": index,
                    "text": value,
                    "x0": x0,
                    "x1": x1,
                    "top": top,
                    "bottom": bottom,
                }
            )
        return output
    finally:
        text_page.close()


def pdfium_comparison_glyphs(
    pdfium_page: Any,
    page_glyphs: list[dict[str, Any]] | None = None,
) -> list[tuple[int, str, tuple[float, float, float, float]]]:
    """Return PDFium '<'/'>' boxes in pdfplumber's top-origin page coordinates."""
    glyphs = page_glyphs if page_glyphs is not None else pdfium_page_glyphs(pdfium_page)
    return [
        (
            int(glyph["index"]),
            str(glyph["text"]),
            (float(glyph["x0"]), float(glyph["x1"]), float(glyph["top"]), float(glyph["bottom"])),
        )
        for glyph in glyphs
        if glyph.get("text") in ("<", ">")
    ]


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def _pdfium_text_rows(page_glyphs: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    visible = [
        glyph
        for glyph in page_glyphs
        if isinstance(glyph.get("text"), str)
        and glyph["text"]
        and not glyph["text"].isspace()
        and glyph["text"].isprintable()
        and float(glyph["x1"]) > float(glyph["x0"])
        and float(glyph["bottom"]) > float(glyph["top"])
    ]
    visible.sort(key=lambda glyph: ((float(glyph["top"]) + float(glyph["bottom"])) / 2.0, float(glyph["x0"])))
    rows: list[list[dict[str, Any]]] = []
    row_centers: list[list[float]] = []
    for glyph in visible:
        center = (float(glyph["top"]) + float(glyph["bottom"])) / 2.0
        centers = row_centers[-1] if row_centers else []
        row_center = (centers[(len(centers) - 1) // 2] + centers[len(centers) // 2]) / 2.0 if centers else None
        if row_center is None or abs(center - row_center) > 5.5:
            rows.append([glyph])
            row_centers.append([center])
        else:
            rows[-1].append(glyph)
            centers.append(center)
    for row in rows:
        row.sort(key=lambda glyph: (float(glyph["x0"]), int(glyph["index"])))
    return rows


def _pdfium_equation_text(row: list[dict[str, Any]]) -> str:
    heights = [float(glyph["bottom"]) - float(glyph["top"]) for glyph in row]
    median_height = _median(heights)
    baseline_height_floor = max(heights) * 0.8
    baseline_glyphs = [height for height in heights if height >= baseline_height_floor]
    baseline_height = _median(baseline_glyphs) if baseline_glyphs else median_height
    baseline_center = _median(
        [
            (float(glyph["top"]) + float(glyph["bottom"])) / 2.0
            for glyph in row
            if float(glyph["bottom"]) - float(glyph["top"]) >= baseline_height_floor
        ]
    ) if baseline_glyphs else _median([(float(glyph["top"]) + float(glyph["bottom"])) / 2.0 for glyph in row])
    output = ""
    previous: dict[str, Any] | None = None
    operators = "=+−-×*/∑"
    no_space_before = "),.%:"
    no_space_after = "(,."
    for glyph in row:
        value = str(glyph["text"])
        if len(value) != 1:
            return ""
        height = float(glyph["bottom"]) - float(glyph["top"])
        center = (float(glyph["top"]) + float(glyph["bottom"])) / 2.0
        is_script = value.isalnum() and height <= baseline_height * 0.75
        script_prefix = ""
        if is_script and center <= baseline_center - 2.0:
            script_prefix = "^"
        elif is_script and center >= baseline_center + 2.0:
            script_prefix = "_"
        if previous is not None:
            previous_value = str(previous["text"])
            gap = float(glyph["x0"]) - float(previous["x1"])
            space = gap >= max(2.8, median_height * 0.28)
            if previous_value in operators or value in operators:
                space = True
            if value in no_space_before or previous_value in no_space_after or script_prefix:
                space = False
            if space and output and not output.endswith(" "):
                output += " "
        output += script_prefix + value
        previous = glyph
    return " ".join(output.strip().split())


def pdfium_horizontal_equation_words(page_glyphs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rebuild only short, flat equations whose nearby glyph rows show no stacked layout."""
    rows = _pdfium_text_rows(page_glyphs)
    if len(rows) > MAX_PDFIUM_TEXT_ROWS:
        return []
    candidates: list[dict[str, Any]] = []
    allowed = set("=+−-×*/().,%:∑") | set("만원")
    for row_index, row in enumerate(rows):
        text = _pdfium_equation_text(row)
        if not text or "=" not in text or len(text) > 100:
            continue
        if not any(char.isascii() and char.isalnum() for char in text):
            continue
        if any(not (char.isspace() or (char.isascii() and char.isalnum()) or char in allowed or char in "^_") for char in text):
            continue
        baseline = _median([(float(glyph["top"]) + float(glyph["bottom"])) / 2.0 for glyph in row])
        x0 = min(float(glyph["x0"]) for glyph in row)
        x1 = max(float(glyph["x1"]) for glyph in row)
        adjacent_rows: list[list[dict[str, Any]]] = []
        for other_index in range(max(0, row_index - 3), min(len(rows), row_index + 4)):
            if other_index == row_index:
                continue
            other_row = rows[other_index]
            other_center = _median([(float(glyph["top"]) + float(glyph["bottom"])) / 2.0 for glyph in other_row])
            vertical_distance = abs(other_center - baseline)
            if not 5.5 < vertical_distance <= 20.0:
                continue
            other_x0 = min(float(glyph["x0"]) for glyph in other_row)
            other_x1 = max(float(glyph["x1"]) for glyph in other_row)
            overlap = max(0.0, min(x1, other_x1) - max(x0, other_x0))
            horizontal_gap = max(0.0, max(x0, other_x0) - min(x1, other_x1))
            if overlap >= 8.0 or horizontal_gap <= 32.0:
                adjacent_rows.append(other_row)
        adjacent_text = ["".join(str(glyph["text"]) for glyph in row) for row in adjacent_rows]
        has_fraction_structure = any(any(char in text for char in "()/∑") for text in adjacent_text)
        has_adjacent_operands = any(
            sum(char.isascii() and char.isalnum() for char in text) >= 2
            for text in adjacent_text
        )
        if has_fraction_structure and has_adjacent_operands:
            continue
        candidates.append(
            {
                "text": text,
                "x0": x0,
                "x1": x1,
                "top": min(float(glyph["top"]) for glyph in row),
                "bottom": max(float(glyph["bottom"]) for glyph in row),
                "baseline": baseline,
            }
        )
    return candidates


def apply_pdfium_horizontal_equations(
    words: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Replace a pdfplumber word run only when its compact glyph sequence agrees exactly."""
    output = list(words)

    def compact(value: str) -> str:
        return "".join(char for char in value if char.isalnum() or char in "=+−-×*/().,%:∑")

    for candidate in candidates:
        matched: list[dict[str, Any]] = []
        for word in output:
            try:
                x0, x1 = float(word["x0"]), float(word["x1"])
                top, bottom = float(word["top"]), float(word["bottom"])
            except (KeyError, TypeError, ValueError):
                continue
            center_x = (x0 + x1) / 2.0
            center_y = (top + bottom) / 2.0
            if (
                float(candidate["x0"]) - 2.0 <= center_x <= float(candidate["x1"]) + 2.0
                and abs(center_y - float(candidate["baseline"])) <= 6.0
            ):
                matched.append(word)
        if not matched:
            continue
        existing_text = "".join(str(word.get("text", "")) for word in sorted(matched, key=lambda word: float(word["x0"])))
        rebuilt_text = str(candidate["text"])
        if not compact(existing_text) or compact(existing_text) != compact(rebuilt_text.replace("^", "").replace("_", "")):
            continue
        output = [word for word in output if word not in matched]
        output.append(
            {
                "text": rebuilt_text,
                "x0": float(candidate["x0"]),
                "x1": float(candidate["x1"]),
                "top": float(candidate["top"]),
                "bottom": float(candidate["bottom"]),
            }
        )
    return output


def pdfium_stacked_equation_words(page_glyphs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rebuild a narrow fraction when PDFium geometry brackets a formula baseline."""
    rows = _pdfium_text_rows(page_glyphs)
    if len(rows) > MAX_PDFIUM_TEXT_ROWS:
        return []
    row_centers = [
        _median([(float(glyph["top"]) + float(glyph["bottom"])) / 2.0 for glyph in row])
        for row in rows
    ]
    candidates: list[dict[str, Any]] = []
    for base_index, base_row in enumerate(rows):
        base_center = row_centers[base_index]
        if not any(str(glyph["text"]) == "=" for glyph in base_row):
            continue
        above = [
            row_index
            for row_index, center in enumerate(row_centers)
            if 5.0 <= base_center - center <= 16.0
        ]
        below = [
            row_index
            for row_index, center in enumerate(row_centers)
            if 5.0 <= center - base_center <= 16.0
        ]
        for numerator_index in above:
            numerator_row = rows[numerator_index]
            numerator_text = _pdfium_equation_text(numerator_row)
            if sum(char.isalnum() for char in numerator_text) < 2:
                continue
            numerator_left = min(float(glyph["x0"]) for glyph in numerator_row)
            numerator_right = max(float(glyph["x1"]) for glyph in numerator_row)
            for denominator_index in below:
                denominator_row = rows[denominator_index]
                denominator_text = _pdfium_equation_text(denominator_row)
                if sum(char.isalnum() for char in denominator_text) < 2:
                    continue
                denominator_left = min(float(glyph["x0"]) for glyph in denominator_row)
                denominator_right = max(float(glyph["x1"]) for glyph in denominator_row)
                fraction_left = max(numerator_left, denominator_left)
                fraction_right = min(numerator_right, denominator_right)
                if fraction_right - fraction_left < 8.0:
                    continue
                prefix_glyphs = [
                    glyph for glyph in base_row if float(glyph["x1"]) <= fraction_left + 1.0
                ]
                suffix_glyphs = [
                    glyph for glyph in base_row if float(glyph["x0"]) >= fraction_right - 1.0
                ]
                if (
                    not prefix_glyphs
                    or len(prefix_glyphs) + len(suffix_glyphs) != len(base_row)
                ):
                    continue
                prefix_text = _pdfium_equation_text(prefix_glyphs)
                suffix_text = _pdfium_equation_text(suffix_glyphs) if suffix_glyphs else ""
                if not re.match(r"^[A-Z]{1,8}\s*=", prefix_text):
                    continue
                rebuilt_text = " ".join(
                    part for part in (prefix_text, f"{numerator_text}/{denominator_text}", suffix_text) if part
                )
                if len(rebuilt_text) > 180:
                    continue
                combined_glyphs = [*prefix_glyphs, *numerator_row, *denominator_row, *suffix_glyphs]
                candidates.append(
                    {
                        "text": rebuilt_text,
                        "x0": min(float(glyph["x0"]) for glyph in combined_glyphs),
                        "x1": max(float(glyph["x1"]) for glyph in combined_glyphs),
                        "top": min(float(glyph["top"]) for glyph in combined_glyphs),
                        "bottom": max(float(glyph["bottom"]) for glyph in combined_glyphs),
                    }
                )
    unique: dict[tuple[str, float, float, float, float], dict[str, Any]] = {}
    for candidate in candidates:
        key = (
            str(candidate["text"]),
            round(float(candidate["x0"]), 1),
            round(float(candidate["x1"]), 1),
            round(float(candidate["top"]), 1),
            round(float(candidate["bottom"]), 1),
        )
        unique[key] = candidate
    return list(unique.values())


def apply_pdfium_stacked_equations(
    words: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Replace flattened fraction fragments only when all text fits the geometry-backed formula."""
    output = list(words)

    def compact(value: str) -> str:
        return "".join(char for char in value if char.isalnum() or char in "=+−-×*/().,%:∑")

    for candidate in candidates:
        matched: list[dict[str, Any]] = []
        for word in output:
            try:
                x0, x1 = float(word["x0"]), float(word["x1"])
                top, bottom = float(word["top"]), float(word["bottom"])
            except (KeyError, TypeError, ValueError):
                continue
            center_x = (x0 + x1) / 2.0
            center_y = (top + bottom) / 2.0
            if (
                float(candidate["x0"]) - 2.0 <= center_x <= float(candidate["x1"]) + 2.0
                and float(candidate["top"]) - 2.0 <= center_y <= float(candidate["bottom"]) + 2.0
            ):
                matched.append(word)
        if not matched:
            continue
        existing_text = "".join(
            str(word.get("text", ""))
            for word in sorted(matched, key=lambda word: (float(word["x0"]), float(word["top"])))
        )
        observed = Counter(compact(existing_text).casefold())
        expected = Counter(compact(str(candidate["text"])).replace("^", "").replace("_", "").casefold())
        if not observed or any(count > expected[char] for char, count in observed.items()):
            continue
        formula_name = re.match(r"^([A-Z]{1,8})\s*=", str(candidate["text"]))
        if not formula_name or formula_name.group(1).casefold() not in compact(existing_text).casefold():
            continue
        output = [word for word in output if word not in matched]
        output.append(
            {
                "text": str(candidate["text"]),
                "x0": float(candidate["x0"]),
                "x1": float(candidate["x1"]),
                "top": float(candidate["top"]),
                "bottom": float(candidate["bottom"]),
            }
        )
    return output


def restore_unmapped_comparison_glyphs(
    page_chars: list[dict[str, Any]],
    comparison_glyphs: list[tuple[int, str, tuple[float, float, float, float]]],
) -> int:
    """Replace only NUL chars with a unique, tightly overlapping PDFium '<'/'>' glyph."""
    center_distance_limit = 2.5
    smaller_box_overlap_minimum = 0.65
    proposals: dict[int, list[dict[str, Any]]] = defaultdict(list)
    glyph_values: dict[int, str] = {}

    for char in page_chars:
        if char.get("text") != "\x00":
            continue
        try:
            char_box = tuple(float(char[key]) for key in ("x0", "x1", "top", "bottom"))
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(part) for part in char_box):
            continue
        char_x0, char_x1, char_top, char_bottom = char_box
        char_width = char_x1 - char_x0
        char_height = char_bottom - char_top
        char_area = char_width * char_height
        if char_width <= 0 or char_height <= 0:
            continue

        matches: list[tuple[int, str]] = []
        for glyph_id, glyph_value, glyph_box in comparison_glyphs:
            glyph_x0, glyph_x1, glyph_top, glyph_bottom = glyph_box
            glyph_width = glyph_x1 - glyph_x0
            glyph_height = glyph_bottom - glyph_top
            glyph_area = glyph_width * glyph_height
            if glyph_width <= 0 or glyph_height <= 0:
                continue
            center_distance = math.hypot(
                (char_x0 + char_x1 - glyph_x0 - glyph_x1) / 2,
                (char_top + char_bottom - glyph_top - glyph_bottom) / 2,
            )
            intersection_width = max(0.0, min(char_x1, glyph_x1) - max(char_x0, glyph_x0))
            intersection_height = max(0.0, min(char_bottom, glyph_bottom) - max(char_top, glyph_top))
            overlap_fraction = (intersection_width * intersection_height) / min(char_area, glyph_area)
            if (
                center_distance <= center_distance_limit
                and overlap_fraction >= smaller_box_overlap_minimum
            ):
                matches.append((glyph_id, glyph_value))

        if len(matches) == 1:
            glyph_id, glyph_value = matches[0]
            proposals[glyph_id].append(char)
            glyph_values[glyph_id] = glyph_value

    restored = 0
    for glyph_id, matched_chars in proposals.items():
        # Require a reciprocal one-to-one match. A sign near multiple damaged
        # characters, or multiple signs near one character, is left unresolved.
        if len(matched_chars) == 1:
            matched_chars[0]["text"] = glyph_values[glyph_id]
            restored += 1
    return restored


def pdf_blocks(data: bytes) -> list[dict[str, Any]]:
    from contextlib import ExitStack

    import pdfplumber

    if b"/Encrypt" in data:
        raise PermissionError("encrypted PDF")
    output: list[dict[str, Any]] = []
    with ExitStack() as resources:
        document = resources.enter_context(pdfplumber.open(io.BytesIO(data)))
        if document.metadata.get("Encrypted") is True:
            raise PermissionError("encrypted PDF")
        if len(document.pages) > MAX_PDF_PAGES:
            raise ValidationOverflow("VALIDATION_ERROR: PDF page budget exceeded")
        pdfium_document = None
        pdfium_open_attempted = False
        for page_number, page in enumerate(document.pages, 1):
            page_chars = page.chars
            page_glyphs: list[dict[str, Any]] = []
            has_unmapped_glyph = any(char.get("text") == "\x00" for char in page_chars)
            has_equation_candidate = any(char.get("text") == "=" for char in page_chars)
            if has_unmapped_glyph or has_equation_candidate:
                if not pdfium_open_attempted:
                    pdfium_open_attempted = True
                    try:
                        import pypdfium2

                        candidate_pdfium_document = pypdfium2.PdfDocument(data)
                        if len(candidate_pdfium_document) == len(document.pages):
                            pdfium_document = candidate_pdfium_document
                            resources.callback(pdfium_document.close)
                        else:
                            candidate_pdfium_document.close()
                    except Exception:
                        # This is a safe, optional correction path. Failure
                        # leaves NULs for block() to mark as U+FFFD; direct-text
                        # validation then prevents damaged claims from entering knowledge.
                        pdfium_document = None
                if pdfium_document is not None:
                    try:
                        pdfium_page = pdfium_document[page_number - 1]
                        page_glyphs = pdfium_page_glyphs(pdfium_page)
                        if has_unmapped_glyph:
                            restore_unmapped_comparison_glyphs(
                                page_chars,
                                pdfium_comparison_glyphs(pdfium_page, page_glyphs),
                            )
                    except Exception:
                        # Keep pdfplumber's layout output and undecodable marker.
                        page_glyphs = []
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            if page_glyphs:
                try:
                    words = apply_pdfium_horizontal_equations(
                        words,
                        pdfium_horizontal_equation_words(page_glyphs),
                    )
                    words = apply_pdfium_stacked_equations(
                        words,
                        pdfium_stacked_equation_words(page_glyphs),
                    )
                except Exception:
                    # Keep pdfplumber's source text and geometry when this
                    # bounded, optional formula-reconstruction path fails.
                    pass
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
                if len(output) > MAX_CSV_BLOCKS:
                    raise ValidationOverflow("VALIDATION_ERROR: CSV logical block budget exceeded")
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


if __name__ == "__main__":
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
