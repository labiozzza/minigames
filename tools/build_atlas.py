#!/usr/bin/env python3
"""Pack assets/plumber/tiles/*.png into public/assets/plumber/atlas.{png,json}.

Grid layout with 2px padding, fixed column count, square 256 tiles. Frame order is
sorted by name for determinism. Preserves the existing `assetgen_status` marker.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TILES = ROOT / 'assets' / 'plumber' / 'tiles'
OUT = ROOT / 'public' / 'assets' / 'plumber'
COLS = 4
PAD = 2


def main() -> int:
    files = sorted(TILES.glob('*.png'))
    if not files:
        print('no tiles found in', TILES, file=sys.stderr)
        return 1
    imgs = [(p.stem, Image.open(p).convert('RGBA')) for p in files]
    tile_w = max(im.width for _, im in imgs)
    tile_h = max(im.height for _, im in imgs)
    rows = (len(imgs) + COLS - 1) // COLS
    sheet_w = PAD + COLS * (tile_w + PAD)
    sheet_h = PAD + rows * (tile_h + PAD)
    sheet = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))
    frames: dict[str, dict] = {}
    for i, (name, im) in enumerate(imgs):
        c, r = i % COLS, i // COLS
        x = PAD + c * (tile_w + PAD)
        y = PAD + r * (tile_h + PAD)
        sheet.alpha_composite(im, (x, y))
        frames[name] = {
            'frame': {'x': x, 'y': y, 'w': im.width, 'h': im.height},
            'rotated': False,
            'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': im.width, 'h': im.height},
            'sourceSize': {'w': im.width, 'h': im.height},
        }
    status = 'PROCESSING_NOT_APPROVED'
    meta_path = OUT / 'atlas.json'
    if meta_path.exists():
        try:
            status = json.loads(meta_path.read_text()).get('assetgen_status', status)
        except Exception:
            pass
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / 'atlas.png')
    meta_path.write_text(json.dumps({
        'frames': frames,
        'meta': {'image': 'atlas.png', 'format': 'RGBA8888', 'size': {'w': sheet_w, 'h': sheet_h}, 'scale': '1', 'app': 'MiniGames AssetGen'},
        'assetgen_status': status,
    }, indent=2) + '\n')
    print(f'packed {len(frames)} frames -> {sheet_w}x{sheet_h}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
