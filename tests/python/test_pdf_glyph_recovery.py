from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "adapters" / "document-format-python"))

from worker import (
    MAX_PDFIUM_PAGE_CHARS,
    apply_pdfium_horizontal_equations,
    apply_pdfium_stacked_equations,
    block,
    pdfium_horizontal_equation_words,
    pdfium_page_glyphs,
    pdfium_recoverable_glyphs,
    pdfium_stacked_equation_words,
    restore_pdfium_numbered_list_markers,
    restore_unmapped_safe_glyphs,
)


def damaged_char(x0: float = 10, x1: float = 18, top: float = 20, bottom: float = 32) -> dict[str, object]:
    return {"text": "\x00", "x0": x0, "x1": x1, "top": top, "bottom": bottom}


def recoverable_glyph(
    glyph_id: int,
    value: str,
    box: tuple[float, float, float, float] = (11, 17, 21, 31),
) -> tuple[int, str, tuple[float, float, float, float]]:
    return glyph_id, value, box


class PdfGlyphRecoveryTests(unittest.TestCase):
    def test_pdf_block_preserves_visual_line_boundaries_and_segment_offsets(self) -> None:
        first = "현금과 이익은 다를 수 있다"
        second = "분산투자로 체계적 위험은 제거할 수 없다"
        combined = f"{first}\n{second}"

        result = block(
            combined,
            [],
            [
                {"start": 0, "end": len(first), "selectors": [{"type": "PageSelector", "page": 3}]},
                {
                    "start": len(first) + 1,
                    "end": len(combined),
                    "selectors": [{"type": "PageSelector", "page": 8}],
                },
            ],
            preserve_line_breaks=True,
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["text"], combined)
        self.assertEqual(
            [result["text"][segment["start"] : segment["end"]] for segment in result["segments"]],
            [first, second],
        )

    def test_restores_a_unique_overlapping_comparison_sign(self) -> None:
        chars = [damaged_char(), {"text": "N", "x0": 2, "x1": 8, "top": 20, "bottom": 32}]

        restored = restore_unmapped_safe_glyphs(
            chars,
            [recoverable_glyph(42, ">")],
        )

        self.assertEqual(restored, 1)
        self.assertEqual(chars[0]["text"], ">")
        self.assertEqual(chars[1]["text"], "N")

    def test_keeps_a_glyph_when_two_signs_match_the_same_box(self) -> None:
        char = damaged_char()

        restored = restore_unmapped_safe_glyphs(
            [char],
            [recoverable_glyph(42, ">"), recoverable_glyph(43, "<")],
        )

        self.assertEqual(restored, 0)
        self.assertEqual(char["text"], "\x00")

    def test_keeps_two_damaged_glyphs_that_compete_for_one_sign(self) -> None:
        chars = [damaged_char(), damaged_char()]

        restored = restore_unmapped_safe_glyphs(chars, [recoverable_glyph(42, "<")])

        self.assertEqual(restored, 0)
        self.assertEqual([char["text"] for char in chars], ["\x00", "\x00"])

    def test_keeps_distant_or_low_overlap_boxes_undecodable(self) -> None:
        distant = damaged_char()
        low_overlap = damaged_char()

        restored = restore_unmapped_safe_glyphs(
            [distant, low_overlap],
            [
                recoverable_glyph(42, ">", (20, 26, 21, 31)),
                recoverable_glyph(43, "<", (16.5, 22.5, 21, 31)),
            ],
        )

        self.assertEqual(restored, 0)
        self.assertEqual([char["text"] for char in (distant, low_overlap)], ["\x00", "\x00"])

    def test_ignores_non_nul_characters_and_invalid_boxes(self) -> None:
        ordinary = {"text": "?", "x0": 10, "x1": 18, "top": 20, "bottom": 32}
        invalid = {"text": "\x00", "x0": 10, "x1": 10, "top": 20, "bottom": 32}

        restored = restore_unmapped_safe_glyphs(
            [ordinary, invalid],
            [recoverable_glyph(42, ">")],
        )

        self.assertEqual(restored, 0)
        self.assertEqual(ordinary["text"], "?")
        self.assertEqual(invalid["text"], "\x00")

    def test_restores_safe_formula_glyphs_but_filters_letters(self) -> None:
        glyphs = [
            {"index": 1, "text": "=", "x0": 11, "x1": 17, "top": 21, "bottom": 31},
            {"index": 2, "text": "1", "x0": 11, "x1": 17, "top": 41, "bottom": 51},
            {"index": 3, "text": "(", "x0": 11, "x1": 17, "top": 61, "bottom": 71},
            {"index": 4, "text": "A", "x0": 11, "x1": 17, "top": 81, "bottom": 91},
            {"index": 5, "text": "한", "x0": 11, "x1": 17, "top": 101, "bottom": 111},
        ]
        recoverable = pdfium_recoverable_glyphs(None, glyphs)
        chars = [
            damaged_char(top=20, bottom=32),
            damaged_char(top=40, bottom=52),
            damaged_char(top=60, bottom=72),
        ]

        restored = restore_unmapped_safe_glyphs(chars, recoverable)

        self.assertEqual([value for _, value, _ in recoverable], ["=", "1", "("])
        self.assertEqual(restored, 3)
        self.assertEqual([char["text"] for char in chars], ["=", "1", "("])

    def test_restores_a_numbered_list_prefix_only_with_matching_pdfium_geometry(self) -> None:
        chars = [
            damaged_char(10, 18, 20, 32),
            damaged_char(18, 22, 20, 32),
            damaged_char(22, 26, 20, 32),
            {"text": "투", "x0": 29, "x1": 35, "top": 21, "bottom": 33},
        ]
        glyphs = [
            {"index": 1, "text": "1", "x0": 11, "x1": 16, "top": 22, "bottom": 32},
            {"index": 2, "text": ".", "x0": 18.5, "x1": 20, "top": 30.5, "bottom": 32},
            {"index": 3, "text": " ", "x0": 18, "x1": 18, "top": 32, "bottom": 32},
            {"index": 4, "text": "투", "x0": 29, "x1": 35, "top": 21, "bottom": 33},
        ]

        restored = restore_pdfium_numbered_list_markers(chars, glyphs)

        self.assertEqual(restored, 3)
        self.assertEqual([char["text"] for char in chars], ["1", ".", " ", "투"])

    def test_keeps_a_numbered_list_prefix_when_the_period_baseline_disagrees(self) -> None:
        chars = [
            damaged_char(10, 18, 20, 32),
            damaged_char(18, 22, 20, 32),
            damaged_char(22, 26, 20, 32),
            {"text": "투", "x0": 29, "x1": 35, "top": 21, "bottom": 33},
        ]
        glyphs = [
            {"index": 1, "text": "1", "x0": 11, "x1": 16, "top": 22, "bottom": 32},
            {"index": 2, "text": ".", "x0": 18.5, "x1": 20, "top": 29, "bottom": 31},
            {"index": 3, "text": " ", "x0": 18, "x1": 18, "top": 32, "bottom": 32},
            {"index": 4, "text": "투", "x0": 29, "x1": 35, "top": 21, "bottom": 33},
        ]

        restored = restore_pdfium_numbered_list_markers(chars, glyphs)

        self.assertEqual(restored, 0)
        self.assertEqual([char["text"] for char in chars], ["\x00", "\x00", "\x00", "투"])

    def test_rebuilds_a_flat_formula_and_marks_its_superscript(self) -> None:
        glyphs = formula_glyphs("FV=PV(1+r)n", superscript="n")

        candidates = pdfium_horizontal_equation_words(glyphs)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["text"], "FV = PV(1 + r)^n")

    def test_rebuilds_a_bracketed_capm_formula_with_pdfium_subscript_geometry(self) -> None:
        formula = "E(Ri)=Rf+[E(Rm)−Rf]βi"
        glyphs = formula_glyphs(formula)
        for glyph in glyphs:
            if glyph["text"] in {"i", "f", "m"}:
                glyph["top"] = float(glyph["top"]) + 6.0
                glyph["bottom"] = float(glyph["top"]) + 4.0

        candidates = pdfium_horizontal_equation_words(glyphs)

        self.assertEqual(len(candidates), 1)
        expected = "E(R_i) = R_f + [E(R_m) − R_f]β_i"
        self.assertEqual(candidates[0]["text"], expected)
        candidate = candidates[0]
        flattened = [
            {
                "text": formula,
                "x0": candidate["x0"],
                "x1": candidate["x1"],
                "top": float(candidate["baseline"]) - 6.0,
                "bottom": float(candidate["baseline"]) + 6.0,
            }
        ]
        self.assertEqual(
            [word["text"] for word in apply_pdfium_horizontal_equations(flattened, candidates)],
            [expected],
        )

    def test_does_not_flatten_a_fraction_with_overlapping_rows(self) -> None:
        glyphs = formula_glyphs("NPV=SUM-I0")
        glyphs.extend(formula_glyphs("CFt", top=90, start_x=40))
        glyphs.extend(formula_glyphs("(1+r)t", top=110, start_x=40))
        equality = formula_glyphs("PV=")
        fraction_left = equality[-1]["x1"] + 7.0
        glyphs.extend(equality)
        glyphs.extend(formula_glyphs("FV", top=90, start_x=fraction_left))
        glyphs.extend(formula_glyphs("(1+r)n", top=110, start_x=fraction_left))

        candidates = pdfium_horizontal_equation_words(glyphs)

        self.assertFalse(any(candidate["text"].startswith("NPV") or candidate["text"] == "PV =" for candidate in candidates))

    def test_rebuilds_a_stacked_present_value_fraction_from_aligned_glyph_rows(self) -> None:
        glyphs = formula_glyphs("PV=", top=100, start_x=20)
        glyphs.extend(formula_glyphs("FV", top=90, start_x=80))
        glyphs.extend(formula_glyphs("(1+r)n", top=110, start_x=75, superscript="n"))

        candidates = pdfium_stacked_equation_words(glyphs)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["text"], "PV = FV/(1 + r)^n")
        words = [
            {"text": "PV = r)n", "x0": 20, "x1": 125, "top": 99, "bottom": 120},
            {"text": "unrelated", "x0": 200, "x1": 250, "top": 99, "bottom": 120},
        ]

        rebuilt = apply_pdfium_stacked_equations(words, candidates)

        self.assertEqual([word["text"] for word in rebuilt], ["unrelated", "PV = FV/(1 + r)^n"])

    def test_rebuilds_a_stacked_fraction_with_a_numeric_left_side(self) -> None:
        glyphs = formula_glyphs("100=", top=100, start_x=10)
        glyphs.extend(formula_glyphs("110", top=90, start_x=80))
        glyphs.extend(formula_glyphs("(1+r)", top=110, start_x=80))

        candidates = pdfium_stacked_equation_words(glyphs)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["text"], "100 = 110/(1 + r)")
        flattened = [{"text": "110 100 = 1 + r", "x0": 10, "x1": 110, "top": 99, "bottom": 120}]
        rebuilt = apply_pdfium_stacked_equations(flattened, candidates)

        self.assertEqual([word["text"] for word in rebuilt], ["100 = 110/(1 + r)"])

    def test_groups_an_unparenthesized_stacked_denominator_when_rebuilding(self) -> None:
        glyphs = formula_glyphs("100=", top=100, start_x=10)
        glyphs.extend(formula_glyphs("110", top=90, start_x=80))
        glyphs.extend(formula_glyphs("1+r", top=110, start_x=80))

        candidates = pdfium_stacked_equation_words(glyphs)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["text"], "100 = 110/(1 + r)")
        rebuilt = apply_pdfium_stacked_equations(
            [{"text": "110 100 = 1 + r", "x0": 10, "x1": 110, "top": 99, "bottom": 120}],
            candidates,
        )
        self.assertEqual([word["text"] for word in rebuilt], ["100 = 110/(1 + r)"])

    def test_keeps_numeric_fraction_candidate_when_flat_text_has_a_different_number(self) -> None:
        glyphs = formula_glyphs("100=", top=100, start_x=10)
        glyphs.extend(formula_glyphs("110", top=90, start_x=80))
        glyphs.extend(formula_glyphs("(1+r)", top=110, start_x=80))
        candidates = pdfium_stacked_equation_words(glyphs)
        flattened = [{"text": "110 105 = 1 + r", "x0": 10, "x1": 110, "top": 99, "bottom": 120}]

        self.assertEqual(apply_pdfium_stacked_equations(flattened, candidates), flattened)

    def test_rebuilds_npv_fraction_with_series_and_suffix_when_flat_text_agrees(self) -> None:
        glyphs = formula_glyphs("NPV=∑", top=100, start_x=10)
        glyphs.extend(formula_glyphs("CFt", top=90, start_x=80, subscript="t"))
        glyphs.extend(formula_glyphs("(1+r)t", top=110, start_x=75, superscript="t"))
        glyphs.extend(formula_glyphs("−I0", top=100, start_x=135, subscript="0"))

        candidates = pdfium_stacked_equation_words(glyphs)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["text"], "NPV = ∑ CF_t/(1 + r)^t − I_0")
        words = [{"text": "NPV = t − I0", "x0": 10, "x1": 155, "top": 99, "bottom": 120}]
        self.assertEqual(
            apply_pdfium_stacked_equations(words, candidates)[0]["text"],
            "NPV = ∑ CF_t/(1 + r)^t − I_0",
        )

    def test_rebuilds_a_korean_labeled_fraction_with_a_formula_suffix(self) -> None:
        glyphs = formula_glyphs("유동비율=", top=100, start_x=10)
        glyphs.extend(formula_glyphs("유동자산", top=90, start_x=60))
        glyphs.extend(formula_glyphs("유동부채", top=110, start_x=60))
        glyphs.extend(formula_glyphs("×100", top=100, start_x=95))

        candidates = pdfium_stacked_equation_words(glyphs)

        self.assertEqual(len(candidates), 1)
        expected = "유동비율 = 유동자산/유동부채 × 100"
        self.assertEqual(candidates[0]["text"], expected)
        words = [
            {"text": "유동비율=유동자산유동부채×100", "x0": 10, "x1": 119, "top": 99, "bottom": 120}
        ]

        self.assertEqual(
            apply_pdfium_stacked_equations(words, candidates)[0]["text"],
            expected,
        )

    def test_keeps_a_stacked_candidate_when_pdfplumber_text_has_an_unrelated_glyph(self) -> None:
        glyphs = formula_glyphs("PV=", top=100, start_x=20)
        glyphs.extend(formula_glyphs("FV", top=90, start_x=80))
        glyphs.extend(formula_glyphs("(1+r)n", top=110, start_x=75, superscript="n"))
        candidates = pdfium_stacked_equation_words(glyphs)
        words = [{"text": "PV = q)n", "x0": 20, "x1": 125, "top": 99, "bottom": 120}]

        self.assertEqual(apply_pdfium_stacked_equations(words, candidates), words)

    def test_replaces_only_an_exactly_matching_pdfplumber_word_run(self) -> None:
        candidate = {
            "text": "FV = PV (1 + r)^n",
            "x0": 10.0,
            "x1": 80.0,
            "top": 20.0,
            "bottom": 32.0,
            "baseline": 26.0,
        }
        words = [
            {"text": "FV=PV(1+r)", "x0": 10, "x1": 74, "top": 20, "bottom": 32},
            {"text": "n", "x0": 74, "x1": 80, "top": 20, "bottom": 26},
            {"text": "other", "x0": 100, "x1": 130, "top": 20, "bottom": 32},
        ]

        rebuilt = apply_pdfium_horizontal_equations(words, [candidate])

        self.assertEqual([word["text"] for word in rebuilt], ["other", "FV = PV (1 + r)^n"])
        self.assertEqual(rebuilt[-1]["x0"], 10.0)
        self.assertEqual(rebuilt[-1]["bottom"], 32.0)

    def test_keeps_a_candidate_when_extracted_glyph_sequence_disagrees(self) -> None:
        candidate = {
            "text": "FV = PV (1 + r)^n",
            "x0": 10.0,
            "x1": 80.0,
            "top": 20.0,
            "bottom": 32.0,
            "baseline": 26.0,
        }
        words = [{"text": "FV=PV(1-r)n", "x0": 10, "x1": 80, "top": 20, "bottom": 32}]

        rebuilt = apply_pdfium_horizontal_equations(words, [candidate])

        self.assertEqual(rebuilt, words)

    def test_pdfium_page_character_budget_fails_closed_before_text_copy(self) -> None:
        class TextPage:
            def count_chars(self) -> int:
                return MAX_PDFIUM_PAGE_CHARS + 1

            def get_text_range(self) -> str:
                raise AssertionError("oversized PDFium text must not be copied")

            def close(self) -> None:
                pass

        class Page:
            def get_textpage(self) -> TextPage:
                return TextPage()

            def get_height(self) -> float:
                return 800.0

        self.assertEqual(pdfium_page_glyphs(Page()), [])


def formula_glyphs(
    value: str,
    *,
    top: float = 100.0,
    start_x: float = 10.0,
    superscript: str | None = None,
    subscript: str | None = None,
) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    x = start_x
    for index, char in enumerate(value):
        is_superscript = char == superscript
        is_subscript = char == subscript
        glyph_top = top
        if is_subscript:
            glyph_top += 6.0
        height = 4.0 if is_superscript else 10.0
        if is_subscript:
            height = 4.0
        width = 4.0 if char in "=+-" else 6.0
        output.append(
            {
                "index": index,
                "text": char,
                "x0": x,
                "x1": x + width,
                "top": glyph_top,
                "bottom": glyph_top + height,
            }
        )
        x += width + 1.0
    return output


if __name__ == "__main__":
    unittest.main()
