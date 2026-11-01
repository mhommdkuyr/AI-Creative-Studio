import importlib.util, unittest
spec=importlib.util.spec_from_file_location("patcher","scripts/patch_musetalk_resumable.py")
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
class PatchTests(unittest.TestCase):
 def test_adds_budget_and_done_marker_once(self):
  src='import os\n    for task_id in inference_config:\n            print(f"Results saved to {output_vid_name}")\n    parser.add_argument("--output_vid_name", type=str, default=None, help="Name of output video file")\n'
  out=mod.patch_text(src)
  self.assertIn('--max_runtime_seconds',out)
  self.assertIn('batch_started = time.monotonic()',out)
  self.assertIn('output_vid_name + ".done"',out)
  self.assertEqual(mod.patch_text(out),out)
if __name__=='__main__': unittest.main()
