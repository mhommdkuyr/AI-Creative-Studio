import importlib.util
import unittest

spec = importlib.util.spec_from_file_location("plan", "scripts/prepare_musetalk_candidates.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CandidatePlanTests(unittest.TestCase):
    def test_filters_bad_lines_and_excludes_overlapping_speakers(self):
        manifest = {"video_sha256":"x", "video_duration_seconds":100, "lines":[
            {"source_start":0,"source_end":6,"speaker_script_id":"a","utterance_index":1,"confidence":0.95,"arabic_word_alignment_coverage":0.9,"timing_overrun":False,"voice_start":0,"voice_end":6,"voice_master":"a.wav","atempo":1.0},
            {"source_start":4,"source_end":9,"speaker_script_id":"b","utterance_index":1,"confidence":0.95,"arabic_word_alignment_coverage":0.9,"timing_overrun":False,"voice_start":0,"voice_end":5,"voice_master":"b.wav","atempo":1.0},
            {"source_start":20,"source_end":25,"speaker_script_id":"c","utterance_index":1,"confidence":0.5,"arabic_word_alignment_coverage":0.9,"timing_overrun":False,"voice_start":0,"voice_end":5,"voice_master":"c.wav","atempo":1.0},
            {"source_start":30,"source_end":35,"speaker_script_id":"d","utterance_index":1,"confidence":0.9,"arabic_word_alignment_coverage":0.5,"timing_overrun":False,"voice_start":0,"voice_end":5,"voice_master":"d.wav","atempo":1.0},
            {"source_start":40,"source_end":45,"speaker_script_id":"e","utterance_index":1,"confidence":0.9,"arabic_word_alignment_coverage":0.9,"timing_overrun":True,"voice_start":0,"voice_end":5,"voice_master":"e.wav","atempo":1.0},
        ]}
        plan = module.build_plan(manifest)
        self.assertEqual(plan["summary"]["safe_lines"], 0)
        self.assertEqual(plan["summary"]["excluded"]["cross_speaker_overlap"], 2)
        self.assertEqual(plan["summary"]["excluded"]["low_confidence"], 1)
        self.assertEqual(plan["summary"]["excluded"]["low_coverage"], 1)
        self.assertEqual(plan["summary"]["excluded"]["timing_overrun"], 1)

    def test_splits_long_line_and_maps_voice_offsets_using_atempo(self):
        manifest = {"lines":[
            {"source_start":10,"source_end":27,"speaker_script_id":"x","utterance_index":2,"confidence":0.9,"arabic_word_alignment_coverage":0.8,"timing_overrun":False,"voice_start":20,"voice_end":37,"voice_master":"x.wav","atempo":1.0}
        ]}
        plan = module.build_plan(manifest, max_clip_seconds=8)
        self.assertEqual(len(plan["clips"]), 3)
        self.assertEqual([c["target_duration"] for c in plan["clips"]], [5.667,5.667,5.667])
        self.assertEqual(plan["clips"][1]["voice_start"], 25.667)
        self.assertEqual(plan["clips"][2]["voice_end"], 37.0)

    def test_excludes_voice_duration_mismatch(self):
        manifest = {"lines":[
            {"source_start":0,"source_end":8,"speaker_script_id":"a","utterance_index":1,"confidence":0.95,"arabic_word_alignment_coverage":0.9,"timing_overrun":False,"voice_start":0,"voice_end":2,"voice_master":"a.wav","atempo":1.0}
        ]}
        plan = module.build_plan(manifest)
        self.assertEqual(plan["summary"]["safe_lines"], 0)
        self.assertEqual(plan["summary"]["excluded"]["audio_duration_mismatch"], 1)

if __name__ == "__main__":
    unittest.main()
