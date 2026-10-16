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
