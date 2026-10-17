"""Run: python -m unittest discover -s .opencode/skills/minigames-assetgen/tests -v"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image

SCRIPT=Path(__file__).resolve().parents[1]/"scripts"/"assetgen.py"
sp=importlib.util.spec_from_file_location("assetgen",SCRIPT)
a=importlib.util.module_from_spec(sp)
sp.loader.exec_module(a)

class TestAssetgen(unittest.TestCase):
    def test_fallback_geometry_and_alpha(self):
        with tempfile.TemporaryDirectory() as d:
            for kind in a.KINDS:
                f=Path(d)/f"{kind}.png"
                a.make_placeholder(kind,256,f)
                self.assertTrue(f.exists())
                self.assertTrue(a.read(f.with_suffix('.meta.json'))['is_placeholder'])
                report=a.transparent_check(f,12, {s:s in a.KINDS[kind] for s in a.SIDES})
                self.assertEqual(report['status'],'VALID_TECH', (kind, report['flags']))
    def test_opaque_fails(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/'opaque.png';Image.new('RGB',(256,256),'white').save(f)
            r=a.transparent_check(f)
            self.assertIn('NO_RGBA_ALPHA', r['flags'])
            self.assertIn('OPAQUE_BACKGROUND', r['flags'])
    def test_slice_and_atlas(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/'sheet.png';Image.new('RGBA',(256,128),(0,0,0,0)).save(f)
            files=a.slice_sheet(f,1,2,Path(d)/'sliced')
            self.assertEqual(len(files),2)
            n=a.atlas(list(map(Path,files)),Path(d)/'atlas.png',Path(d)/'atlas.json',512)
            self.assertEqual(n,2)
            self.assertEqual(len(a.read(Path(d)/'atlas.json')['frames']),2)
    def test_queue_missing_key(self):
        with tempfile.TemporaryDirectory() as d:
            r={'asset_id':'pipe_straight','game_id':'plumber','kind':'pipe-straight','style_id':'v1',
                'prompt':'straight glass pipe', 'logical_cell_px':256}
            request=Path(d)/'request.json';a.dump(request,r)
            a.submit(d,request)
            result=a.process(d,'pipe_straight',False)
            self.assertEqual(result['status'],'WAITING_FOR_PROVIDER')
            self.assertTrue(Path(result['placeholder']).exists())

if __name__=='__main__':unittest.main()


class TestReconcile(unittest.TestCase):
    """TZ v1.2 §17: one canonical source, idempotent, placeholder fallback."""

    def _workspace(self, d):
        ws = Path(d) / "assetgen-work"
        (ws / "jobs").mkdir(parents=True)
        root = Path(d) / "assets" / "plumber"
        (root / "tiles").mkdir(parents=True)
        # Valid transparent tile (concrete: rgba with transparent corners).
        good = root / "tiles" / "pipe_straight.png"
        im = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        for y in range(20, 236):
            for x in range(110, 146):
                im.putpixel((x, y), (150, 180, 220, 255))
        im.save(good)
        # Opaque tile that must be rejected.
        bad = root / "tiles" / "pipe_t.png"
        Image.new("RGB", (256, 256), "white").save(bad)
        # Registry: canonical statuses; budget intentionally lags the ledger.
        (ws / "registry.json").write_text(json.dumps({
            "style_id": "s1", "provider": "test-provider",
            "budget": {"low_used": 0, "low_limit": 24, "medium_used": 0, "medium_limit": 16},
            "assets": {
                "pipe_straight": {"status": "APPROVED", "file": str(good), "source": "finals/pipe_straight.png", "tech": "VALID_TECH"},
                "pipe_t": {"status": "APPROVED", "file": str(bad), "source": "finals/pipe_t.png", "tech": "VALID_TECH"},
                "distributor_basic": {"status": "PLACEHOLDER", "file": str(root / "tiles" / "distributor_basic.png")},
            },
        }), encoding="utf-8")
        (ws / "budget.json").write_text(json.dumps({"low_used": 4, "low_limit": 24, "medium_used": 7, "medium_limit": 16}), encoding="utf-8")
        (root / "tiles.json").write_text(json.dumps({"tiles": {"pipe_straight": {"ports": {"top": True, "bottom": True, "left": False, "right": False}}}}), encoding="utf-8")
        # Legacy job says waiting_for_provider though registry says APPROVED.
        (ws / "jobs" / "pipe_straight.json").write_text(json.dumps({
            "id": "pipe_straight", "request": {"asset_id": "pipe_straight", "prompt": "p", "port_mask": {"top": True, "bottom": True}},
            "status": "WAITING_FOR_PROVIDER", "attempts": 0, "approved": False, "history": [],
            "blocker": "Require OPENAI_API_KEY",
        }), encoding="utf-8")
        return ws, root, good

    def test_reconcile_is_canonical_and_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            ws, root, good = self._workspace(d)
            first = a.reconcile(str(ws), str(root))
            self.assertEqual(first["approved"], 1)               # only the valid tile stays approved
            self.assertEqual([r["id"] for r in first["rejected"]], ["pipe_t"])
            self.assertIn("distributor_basic", first["placeholders"])
            self.assertTrue((ws / "placeholders" / "distributor_basic.png").exists())
            self.assertTrue((ws / "placeholders" / "pipe_t.png").exists())
            self.assertEqual(first["budget"], {"low_used": 4, "low_limit": 24, "medium_used": 7, "medium_limit": 16})
            reg = a.read(ws / "registry.json")
            self.assertEqual(reg["assets"]["pipe_t"]["status"], "REJECTED")
            self.assertEqual(reg["assets"]["pipe_straight"]["state"], "approved")
            self.assertIn("ports_after_rotation", reg["provenance"]["pipe_straight"])
            self.assertEqual(len(reg["provenance"]["pipe_straight"]["ports_after_rotation"]), 4)
            job = a.read(ws / "jobs" / "pipe_straight.json")
            self.assertEqual(job["status"], "APPROVED")
            self.assertTrue(job["approved"])
            self.assertNotIn("blocker", job)
            # Missing job files are synthesised so queue and registry agree.
            self.assertTrue((ws / "jobs" / "distributor_basic.json").exists())
            second = a.reconcile(str(ws), str(root))
            self.assertEqual(second["changed"], 0)               # idempotent: no duplicates, 11-style rerun safe
            self.assertEqual(second["approved"], 1)

    def test_missing_approved_file_becomes_placeholder(self):
        with tempfile.TemporaryDirectory() as d:
            ws, root, good = self._workspace(d)
            good.unlink()
            rep = a.reconcile(str(ws), str(root))
            self.assertIn("pipe_straight", rep["placeholders"])
            reg = a.read(ws / "registry.json")
            self.assertEqual(reg["assets"]["pipe_straight"]["state"], "placeholder")
            self.assertTrue((ws / "placeholders" / "pipe_straight.png").exists())
