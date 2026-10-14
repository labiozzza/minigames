// Generates PWA PNG icons with pure Node (zlib + raw RGBA, no deps).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(root, { recursive: true });

function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([td, data])));
  return Buffer.concat([len, td, data, c]);
}
// Minimalist design: dark rounded background, three tubes with bright liquid.
function draw(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [11, 16, 32, 255];
  const pad = maskable ? Math.floor(size * 0.12) : 0;
  const tubeCols = [[56,189,248],[167,139,250],[52,211,153]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    px[i] = bg[0]; px[i+1] = bg[1]; px[i+2] = bg[2]; px[i+3] = 255;
  }
  const n = 3, tw = Math.floor((size - pad * 2) / (n * 2));
  for (let t = 0; t < n; t++) {
    const cx = pad + tw + t * tw * 2;
    const top = Math.floor(size * 0.30), bot = Math.floor(size * 0.74);
    const w = Math.floor(tw * 0.62);
    const c = tubeCols[t];
    for (let y = top; y < bot; y++) for (let x = cx - w; x <= cx + w; x++) {
      if (x < 0 || x >= size) continue;
      const i = (y * size + x) * 4;
      const edge = Math.abs(x - cx) > w - 2 || y < top + 2;
      const lvl = top + Math.floor((bot - top) * (t === 1 ? 0.35 : 0.15));
      if (edge) { px[i] = 148; px[i+1] = 163; px[i+2] = 184; }
      else if (y >= lvl) {
        const glow = Math.max(0, 24 - Math.abs(x - cx));
        px[i] = Math.min(255, c[0] + glow); px[i+1] = Math.min(255, c[1] + glow); px[i+2] = Math.min(255, c[2] + glow);
      } else { px[i] = 30; px[i+1] = 41; px[i+2] = 59; }
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const [name, size, mask] of [['icon-192.png',192,false],['icon-512.png',512,false],['icon-maskable-512.png',512,true]]) {
  writeFileSync(join(root, name), draw(size, mask));
  console.log('icon written:', name);
}
