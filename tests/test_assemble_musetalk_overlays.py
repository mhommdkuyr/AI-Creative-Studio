import importlib.util, unittest
spec=importlib.util.spec_from_file_location("assemble", "scripts/assemble_musetalk_overlays.py")
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
class OverlayGraphTests(unittest.TestCase):
 def test_offsets_each_clip_and_chains_overlays(self):
  graph,last=mod.build_filter_graph([
   {"source_start":10.0,"source_end":12.0},
   {"source_start":30.0,"source_end":33.0},
  ])
  self.assertIn("PTS-STARTPTS+10.000/TB",graph)
  self.assertIn("between(t,30.000,33.000)",graph)
  self.assertEqual(last,"[v2]")
 def test_empty_plan_returns_base_video_reference(self):
  graph,last=mod.build_filter_graph([])
  self.assertEqual(graph,""); self.assertEqual(last,"0:v")
if __name__=='__main__': unittest.main()
