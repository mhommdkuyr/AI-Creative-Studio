import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "render_existing_arabic_dub.py"
spec = importlib.util.spec_from_file_location("render_existing_arabic_dub", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class MakeSrtTests(unittest.TestCase):
    def test_one_cue_per_rendered_utterance_not_per_asr_fragment(self):
        selected = {
            ("01_li_yang", 1): {"source_start": 10.0, "source_end": 12.5},
            ("02_lu_ming", 2): {"source_start": 13.0, "source_end": 14.0},
        }
        lookup = {
            ("01_li_yang", 1): {"text": "الجملة الأولى"},
            ("02_lu_ming", 2): {"text": "الجملة الثانية"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "captions.srt"
            count = module.make_srt(selected, lookup, output)
            text = output.read_text(encoding="utf-8")
        self.assertEqual(count, 2)
        self.assertEqual(text.count("الجملة الأولى"), 1)
        self.assertEqual(text.count("الجملة الثانية"), 1)
        self.assertIn("00:00:10,000 --> 00:00:12,500", text)

    def test_invalid_or_missing_timing_is_not_written(self):
        selected = {
            ("01", 1): {"source_start": 3.0, "source_end": 2.0},
            ("01", 2): {"source_start": 4.0, "source_end": 5.0},
        }
        lookup = {("01", 1): {"text": "توقيت غير صالح"}, ("01", 2): {"text": "صحيح"}}
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "captions.srt"
            count = module.make_srt(selected, lookup, output)
            text = output.read_text(encoding="utf-8")
        self.assertEqual(count, 1)
        self.assertNotIn("توقيت غير صالح", text)
        self.assertIn("صحيح", text)

if __name__ == "__main__":
    unittest.main()
