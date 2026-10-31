import unittest

from scripts.merge_voice_alignment_audit import merge_alignment_audit


class MergeVoiceAlignmentAuditTests(unittest.TestCase):
    def test_accepts_coverage_gain_only_when_voice_boundaries_match(self):
        manifest = {
            "lines": [{
                "speaker_script_id": "01_li_yang",
                "utterance_index": 1,
                "voice_start": 1.0,
                "voice_end": 3.0,
                "arabic_word_alignment_coverage": 0.5,
            }]
        }
        timing = {
            "tracks": [{
                "speaker_id": "01_li_yang",
                "utterances": [{
                    "utterance_index": 1,
                    "track_start_seconds": 1.1,
                    "track_end_seconds": 3.1,
                    "word_alignment_coverage": 0.9,
                }],
            }]
        }

        result = merge_alignment_audit(manifest, timing)
        line = result["lines"][0]
        self.assertEqual(line["arabic_word_alignment_coverage"], 0.9)
        self.assertEqual(line["voice_start"], 1.0)
        self.assertEqual(line["voice_end"], 3.0)
        self.assertTrue(line["alignment_audit"]["accepted"])

    def test_rejects_boundary_drift_without_changing_original_timing(self):
        manifest = {
            "lines": [{
                "speaker_script_id": "01_li_yang",
                "utterance_index": 1,
                "voice_start": 1.0,
                "voice_end": 3.0,
                "arabic_word_alignment_coverage": 0.5,
            }]
        }
        timing = {
            "tracks": [{
                "speaker_id": "01_li_yang",
                "utterances": [{
                    "utterance_index": 1,
                    "track_start_seconds": 1.6,
                    "track_end_seconds": 3.1,
                    "word_alignment_coverage": 0.95,
                }],
            }]
        }

        result = merge_alignment_audit(manifest, timing)
        line = result["lines"][0]
        self.assertEqual(line["arabic_word_alignment_coverage"], 0.5)
        self.assertEqual(line["voice_start"], 1.0)
        self.assertEqual(line["voice_end"], 3.0)
        self.assertFalse(line["alignment_audit"]["accepted"])
        self.assertEqual(line["alignment_audit"]["reason"], "boundary_drift")

    def test_does_not_lower_existing_coverage(self):
        manifest = {
            "lines": [{
                "speaker_script_id": "01_li_yang",
                "utterance_index": 1,
                "voice_start": 1.0,
                "voice_end": 3.0,
                "arabic_word_alignment_coverage": 0.95,
            }]
        }
        timing = {
            "tracks": [{
                "speaker_id": "01_li_yang",
                "utterances": [{
                    "utterance_index": 1,
                    "track_start_seconds": 1.0,
                    "track_end_seconds": 3.0,
                    "word_alignment_coverage": 0.7,
                }],
            }]
        }

        result = merge_alignment_audit(manifest, timing)
        line = result["lines"][0]
        self.assertEqual(line["arabic_word_alignment_coverage"], 0.95)
        self.assertFalse(line["alignment_audit"]["accepted"])


if __name__ == "__main__":
    unittest.main()
