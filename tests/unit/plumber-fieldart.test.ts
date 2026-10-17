import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const ATLAS_JSON = resolve(ROOT, 'public/assets/plumber/atlas.json');
const ATLAS_PNG = resolve(ROOT, 'public/assets/plumber/atlas.png');

interface Atlas {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: { image: string; size: { w: number; h: number } };
}

/** Read PNG dimensions straight from the IHDR chunk (no image deps needed). */
function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('plumber field art is packed and wired', () => {
  const atlas: Atlas = JSON.parse(readFileSync(ATLAS_JSON, 'utf8'));

  it('packs every pipe kind plus the field-art frames', () => {
    const pipes = ['pipe_straight', 'pipe_elbow', 'pipe_t', 'pipe_cross', 'pipe_cap', 'valve_basic', 'filter_basic', 'mixer_basic', 'distributor_basic', 'source_basic', 'receiver_basic'];
    for (const f of pipes) expect(atlas.frames, f).toHaveProperty(f);
    // P3: ground + obstacles + decor must exist so the scene never falls back to
    // grey circles / red bars for empty and blocked cells.
    for (const f of ['env_ground', 'obstacle_rock', 'obstacle_rocks', 'obstacle_mound', 'env_garden_bush']) {
      expect(atlas.frames, f).toHaveProperty(f);
    }
  });

  it('atlas.png matches its declared meta size and every frame fits', () => {
    const { w, h } = pngSize(ATLAS_PNG);
    expect(w).toBe(atlas.meta.size.w);
    expect(h).toBe(atlas.meta.size.h);
    for (const [name, { frame }] of Object.entries(atlas.frames)) {
      expect(frame.x + frame.w, name).toBeLessThanOrEqual(w);
      expect(frame.y + frame.h, name).toBeLessThanOrEqual(h);
    }
  });

  it('has a source tile file for every frame', () => {
    for (const name of Object.keys(atlas.frames)) {
      expect(existsSync(resolve(ROOT, `assets/plumber/tiles/${name}.png`)), name).toBe(true);
    }
  });
});
