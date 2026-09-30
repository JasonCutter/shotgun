from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "adapters" / "document-format-python"))

from worker import restore_unmapped_comparison_glyphs


def damaged_char(x0: float = 10, x1: float = 18, top: float = 20, bottom: float = 32) -> dict[str, object]:
    return {"text": "\x00", "x0": x0, "x1": x1, "top": top, "bottom": bottom}


def comparison_glyph(
    glyph_id: int,
    value: str,
    box: tuple[float, float, float, float] = (11, 17, 21, 31),
) -> tuple[int, str, tuple[float, float, float, float]]:
    return glyph_id, value, box


class PdfGlyphRecoveryTests(unittest.TestCase):
    def test_restores_a_unique_overlapping_comparison_sign(self) -> None:
        chars = [damaged_char(), {"text": "N", "x0": 2, "x1": 8, "top": 20, "bottom": 32}]

        restored = restore_unmapped_comparison_glyphs(
            chars,
            [comparison_glyph(42, ">")],
        )

        self.assertEqual(restored, 1)
        self.assertEqual(chars[0]["text"], ">")
        self.assertEqual(chars[1]["text"], "N")

    def test_keeps_a_glyph_when_two_signs_match_the_same_box(self) -> None:
        char = damaged_char()

        restored = restore_unmapped_comparison_glyphs(
            [char],
            [comparison_glyph(42, ">"), comparison_glyph(43, "<")],
        )

        self.assertEqual(restored, 0)
        self.assertEqual(char["text"], "\x00")

    def test_keeps_two_damaged_glyphs_that_compete_for_one_sign(self) -> None:
        chars = [damaged_char(), damaged_char()]

        restored = restore_unmapped_comparison_glyphs(chars, [comparison_glyph(42, "<")])

        self.assertEqual(restored, 0)
        self.assertEqual([char["text"] for char in chars], ["\x00", "\x00"])

    def test_keeps_distant_or_low_overlap_boxes_undecodable(self) -> None:
        distant = damaged_char()
        low_overlap = damaged_char()

        restored = restore_unmapped_comparison_glyphs(
            [distant, low_overlap],
            [
                comparison_glyph(42, ">", (20, 26, 21, 31)),
                comparison_glyph(43, "<", (16.5, 22.5, 21, 31)),
            ],
        )

        self.assertEqual(restored, 0)
        self.assertEqual([char["text"] for char in (distant, low_overlap)], ["\x00", "\x00"])

    def test_ignores_non_nul_characters_and_invalid_boxes(self) -> None:
        ordinary = {"text": "?", "x0": 10, "x1": 18, "top": 20, "bottom": 32}
        invalid = {"text": "\x00", "x0": 10, "x1": 10, "top": 20, "bottom": 32}

        restored = restore_unmapped_comparison_glyphs(
            [ordinary, invalid],
            [comparison_glyph(42, ">")],
        )

        self.assertEqual(restored, 0)
        self.assertEqual(ordinary["text"], "?")
        self.assertEqual(invalid["text"], "\x00")


if __name__ == "__main__":
    unittest.main()
