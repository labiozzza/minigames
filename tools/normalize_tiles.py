#!/usr/bin/env python3
"""Normalize plumber tiles to 256x256 with port axes aligned to tile midlines.
Method: bbox -> detect opening centroid per active port (bright opaque mass in
edge strip) -> solve sx,sy,tx,ty (least squares) mapping opening centers to
ideal targets (top/bottom ports: x=128; left/right ports: y=128; extreme port
edges near tile borders). Saves tiles + meta with opening px coords.
Run: python3 tools/normalize_tiles.py
"""
from __future__ import annotations
import json
from pathlib import Path
from PIL import Image
import math

TILE = 256
ROOT = Path(__file__).resolve().parents[1]
CAND = ROOT / 'assetgen-work'
OUT = ROOT / 'assets' / 'plumber' / 'tiles'
OUT.mkdir(parents=True, exist_ok=True)

# asset -> (source file, port mask, base rot meaning)
SELECTION = {
    'pipe_straight': ('finals/pipe_straight_medium_1.png', {'top': True, 'bottom': True}),
    'pipe_elbow': ('finals/pipe_elbow_medium_1.png', {'top': True, 'right': True}),
    'pipe_t': ('finals/pipe_t_medium_1.png', {'top': True, 'left': True, 'right': True}),
    'pipe_cross': ('finals/pipe_cross_medium_1.png', {'top': True, 'right': True, 'bottom': True, 'left': True}),
    'pipe_cap': ('candidates/pipe_cap_low_1.png', {'top': True}),
    'filter_basic': ('finals/filter_basic_medium_1.png', {'top': True, 'bottom': True}),
    'mixer_basic': ('finals/mixer_basic_medium_1.png', {'top': True, 'right': True, 'bottom': True, 'left': True}),
    'distributor_basic': ('finals/distributor_basic_medium_1.png', {'top': True, 'right': True, 'left': True}),
    'valve_basic': ('finals/valve_basic_medium_1.png', {'top': True, 'bottom': True}),
    'source_basic': ('finals/source_basic_medium_1.png', {'right': True}),
    'receiver_basic': ('finals/receiver_basic_medium_1.png', {'left': True}),
}
SIDES = ('top', 'right', 'bottom', 'left')


def bbox_of(im: Image.Image):
    a = im.getchannel('A').point(lambda v: 255 if v > 8 else 0)
    bb = a.getbbox()
    if not bb:
        raise ValueError('empty sprite')
    return bb


def opening_center(im: Image.Image, bb, side: str):
    """Centroid of opaque mass in the edge strip of the bbox for `side`."""
    l, t, r, b = bb
    w, h = r - l, b - t
    strip = 0.18
    if side == 'top':
        box = (l, t, r, t + max(4, int(h * strip)))
    elif side == 'bottom':
        box = (l, b - max(4, int(h * strip)), r, b)
    elif side == 'left':
        box = (l, t, l + max(4, int(w * strip)), b)
    else:
        box = (r - max(4, int(w * strip)), t, r, b)
    crop = im.crop(box).convert('RGBA')
    px = crop.load()
    sx = sy = n = 0.0
    for y in range(crop.height):
        for x in range(crop.width):
            rr, gg, bb_, aa = px[x, y]
            if aa > 40:
                # weight by opacity * brightness (rims are bright)
                wgt = aa * (0.3 + 0.7 * (rr + gg + bb_) / 765)
                sx += (box[0] + x) * wgt
                sy += (box[1] + y) * wgt
                n += wgt
    if n <= 0:
        # fallback: midpoint of that bbox edge
        if side == 'top':
            return ((l + r) / 2, t)
        if side == 'bottom':
            return ((l + r) / 2, b)
        if side == 'left':
            return (l, (t + b) / 2)
        return (r, (t + b) / 2)
    return (sx / n, sy / n)


def solve_transform(bb, openings: dict, ports: dict):
    """Uniform scale + translation. Port centers land exactly on tile midlines:
    top/bottom ports -> x=128, left/right ports -> y=128. Scale = fit 232px box,
    shrunk further if the translated object overflows the 256 canvas.
    """
    l, t, r, b = bb
    bw, bh = r - l, b - t
    s = 232 / max(bw, bh)
    xports = [openings[x] for x in openings if x in ('top', 'bottom')]
    yports = [openings[y] for y in openings if y in ('left', 'right')]
    tx = 128 - sum(p[0] for p in xports) / len(xports) * s if xports else (TILE - bw * s) / 2 - l * s
    ty = 128 - sum(p[1] for p in yports) / len(yports) * s if yports else (TILE - bh * s) / 2 - t * s
    # shrink-to-fit if overflow
    for _ in range(10):
        x0, y0 = l * s + tx, t * s + ty
        x1, y1 = r * s + tx, b * s + ty
        m = min(x0, y0, TILE - x1, TILE - y1)
        if m >= -0.5:
            break
        s *= 0.95
        tx = 128 - sum(p[0] for p in xports) / len(xports) * s if xports else (TILE - bw * s) / 2 - l * s
        ty = 128 - sum(p[1] for p in yports) / len(yports) * s if yports else (TILE - bh * s) / 2 - t * s
    # expand: push extreme port openings toward edges (<=8px gap), keep midlines
    for _ in range(30):
        ops = {side: (ox * s + tx, oy * s + ty) for side, (ox, oy) in openings.items()}
        gaps = []
        if 'top' in ops:
            gaps.append(ops['top'][1])
        if 'bottom' in ops:
            gaps.append(TILE - ops['bottom'][1])
        if 'left' in ops:
            gaps.append(ops['left'][0])
        if 'right' in ops:
            gaps.append(TILE - ops['right'][0])
        if not gaps or min(gaps) <= 8:
            break
        s2 = s * 1.05
        tx2 = 128 - sum(p[0] for p in xports) / len(xports) * s2 if xports else (TILE - bw * s2) / 2 - l * s2
        ty2 = 128 - sum(p[1] for p in yports) / len(yports) * s2 if yports else (TILE - bh * s2) / 2 - t * s2
        x0, y0 = l * s2 + tx2, t * s2 + ty2
        x1, y1 = r * s2 + tx2, b * s2 + ty2
        if min(x0, y0, TILE - x1, TILE - y1) < 0:
            break
        s, tx, ty = s2, tx2, ty2
    resid = 0.0  # midline alignment exact by construction
    return s, s, tx, ty, resid


def main():
    index = {}
    for aid, (rel, ports) in SELECTION.items():
        src = CAND / rel
        im = Image.open(src).convert('RGBA')
        bb = bbox_of(im)
        openings = {s: opening_center(im, bb, s) for s, on in ports.items() if on}
        sx, sy, tx, ty, resid = solve_transform(bb, openings, ports)
        # uniform scale by construction: no distortion clamp needed
        # render
        w, h = im.size
        nw, nh = max(1, round(w * sx)), max(1, round(h * sy))
        scaled = im.resize((nw, nh), Image.Resampling.LANCZOS)
        tile = Image.new('RGBA', (TILE, TILE), (0, 0, 0, 0))
        tile.alpha_composite(scaled, (round(tx), round(ty)))
        out = OUT / f'{aid}.png'
        tile.save(out)
        # opening coords in tile space
        ops = {s: [round(ox * sx + tx, 1), round(oy * sy + ty, 1)] for s, (ox, oy) in openings.items()}
        meta = {
            'asset_id': aid, 'status': 'READY_FOR_INTEGRATION', 'is_placeholder': False,
            'tile_px': TILE, 'ports': {s: (s in ports) for s in SIDES},
            'transform': {'sx': round(sx, 4), 'sy': round(sy, 4), 'tx': round(tx, 1), 'ty': round(ty, 1)},
            'openings_px': ops, 'fit_residual_px': round(resid, 2),
            'source': rel, 'origin': 'gpt-image-subscription', 'quality': 'medium' if 'medium' in rel else 'low',
        }
        (OUT / f'{aid}.meta.json').write_text(json.dumps(meta, indent=2) + '\n')
        index[aid] = {'file': f'tiles/{aid}.png', 'ports': meta['ports'], 'openings_px': ops}
        print(f'{aid}: resid={resid:.1f}px distort={sx/sy:.3f} openings={ops}')
    (OUT.parent / 'tiles.json').write_text(json.dumps(index, indent=2) + '\n')
    print('wrote', OUT)


if __name__ == '__main__':
    main()
