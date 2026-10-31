import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image

module_path = Path(__file__).resolve().parents[1] / "scripts" / "content_local_card_renderer.py"
spec = importlib.util.spec_from_file_location("content_local_card_renderer", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def payload():
    return {"planId": "content-plan-" + "a" * 64, "brandName": "BROS SELL",
            "cards": [{"slot": 1, "title": "Mulakan dengan satu soalan", "body": "Tanya model telefon sebelum membuat cadangan.", "accent": "gold"},
                      {"slot": 2, "title": "Semak maklumat produk", "body": "Padankan model dan maklumat keserasian yang telah disahkan.", "accent": "teal", "layout": "editorial"}]}


class LocalRendererTests(unittest.TestCase):
    def test_real_bytes_decode_and_distinct_pixels(self):
        with tempfile.TemporaryDirectory() as d:
            result = module.render_cards(payload(), d)
            self.assertEqual(result["status"], "LOCAL_TEMPLATE_RENDERED_EDITORIAL_PENDING")
            self.assertEqual(len(result["images"]), 2)
            self.assertEqual(len({x["decodedRgbSha256"] for x in result["images"]}), 2)
            for record in result["images"]:
                with Image.open(Path(d) / record["filename"]) as im:
                    im.load()
                    self.assertEqual(im.size, (1080, 1350))
                    self.assertEqual(im.mode, "RGB")
                self.assertGreater(record["byteLength"], 10000)
            self.assertFalse(result["externalAiProviderGenerationVerified"])
            self.assertFalse(result["editorialApprovalVerified"])
            self.assertFalse(result["executionAllowed"])
            self.assertEqual(json.loads((Path(d) / "manifest.json").read_text())["images"], result["images"])

    def test_deterministic_replay(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            first = module.render_cards(payload(), a)
            second = module.render_cards(payload(), b)
            self.assertEqual(first["images"], second["images"])

    def test_explicit_layouts_are_distinct_and_deterministic(self):
        from PIL import ImageChops
        p = payload()
        p["cards"][0]["layout"] = "split"
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            first = module.render_cards(p, a)
            second = module.render_cards(p, b)
            self.assertEqual(first["images"], second["images"])
            with Image.open(Path(a) / "content_card_01.png") as one, Image.open(Path(a) / "content_card_02.png") as two:
                one.load()
                two.load()
                self.assertIsNotNone(ImageChops.difference(one, two).getbbox())
                points = [(x, y) for y in range(0, 1350, 20) for x in range(0, 1080, 20)]
                changed = sum(one.getpixel(point) != two.getpixel(point) for point in points)
                self.assertGreater(changed / len(points), 0.50)
            self.assertFalse(first["editorialApprovalVerified"])
            self.assertFalse(first["executionAllowed"])

    def test_unknown_layout_fails_closed(self):
        p = payload()
        p["cards"][0]["layout"] = "unknown"
        with tempfile.TemporaryDirectory() as d, self.assertRaisesRegex(ValueError, "INVALID_LAYOUT"):
            module.render_cards(p, d)

    def test_duplicate_cards_rejected(self):
        p = payload()
        p["cards"][1] = {**p["cards"][0], "slot": 2}
        with tempfile.TemporaryDirectory() as d, self.assertRaisesRegex(ValueError, "DUPLICATE_CARD_CONTENT"):
            module.render_cards(p, d)

    def test_invalid_plan_and_control_characters_rejected(self):
        p = payload()
        p["planId"] = "fake"
        with tempfile.TemporaryDirectory() as d, self.assertRaisesRegex(ValueError, "INVALID_PLAN_ID"):
            module.render_cards(p, d)
        p = payload()
        p["cards"][0]["title"] = "Unsafe\ncontrol"
        with tempfile.TemporaryDirectory() as d, self.assertRaisesRegex(ValueError, "INVALID_TITLE"):
            module.render_cards(p, d)

    def test_long_unbreakable_word_rejected(self):
        p = payload()
        p["cards"][0]["body"] = "X" * 300
        with tempfile.TemporaryDirectory() as d, self.assertRaisesRegex(ValueError, "TEXT_DOES_NOT_FIT|UNBREAKABLE_TEXT_TOO_WIDE"):
            module.render_cards(p, d)


if __name__ == "__main__":
    unittest.main()
