#!/usr/bin/env node
// Dev-only: generate images via the local ChatGPT subscription (no paid API).
// Reads credentials from ~/.local/share/opencode/auth.json at runtime; never prints them.
// Usage:
//   node tools/gpt_imagegen_chatgpt.mjs --prompt "clean scene, no text" --out img.png
//   node tools/gpt_imagegen_chatgpt.mjs --prompt-file p.txt --out img.png [--quality low] [--size 1024x1024]
// Ref images: --image ref1.png (repeatable) — roles must be labeled inline in the prompt.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const opts = (name) => args.filter((a, i) => a === name).map((_, k) => args[args.indexOf(name, k === 0 ? 0 : undefined) + 1]);
// simpler: collect all values following repeated flags
function collect(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && i + 1 < args.length) out.push(args[i + 1]);
  return out;
}
void opts;

const promptFile = opt('--prompt-file', null);
const promptArg = opt('--prompt', null);
const out = opt('--out', null);
const quality = opt('--quality', 'low');
const size = opt('--size', '1024x1024');
const images = collect('--image');

if ((!promptFile && !promptArg) || !out) {
  console.error('Usage: gpt_imagegen_chatgpt.mjs --prompt "..."|--prompt-file p.txt --out img.png [--quality low] [--size 1024x1024] [--image ref.png ...]');
  process.exit(1);
}
const prompt = promptFile ? readFileSync(promptFile, 'utf8') : promptArg;

const auth = JSON.parse(readFileSync(`${homedir()}/.local/share/opencode/auth.json`, 'utf8'));
const access = auth?.openai?.access;
const accountId = auth?.openai?.accountId;
if (!access || !accountId) {
  console.error('Missing openai.access/accountId in auth.json');
  process.exit(1);
}

const content = [{ type: 'input_text', text: prompt }];
for (const img of images) {
  const b64 = readFileSync(img).toString('base64');
  content.push({ type: 'input_image', image_url: `data:image/png;base64,${b64}`, detail: 'high' });
}

const body = {
  model: 'gpt-6-sol',
  input: [{ role: 'user', content }],
  tools: [{ type: 'image_generation', output_format: 'png', quality, size }],
  tool_choice: { type: 'image_generation' },
  store: false,
  stream: true,
};

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);
let res;
try {
  res = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access}`,
      'ChatGPT-Account-Id': accountId,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  });
} finally {
  clearTimeout(timer);
}
if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  process.exit(1);
}

let buf = '';
let b64 = null;
const seen = new Set();
for await (const chunk of res.body) {
  buf += Buffer.from(chunk).toString('utf8');
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (payload === '[DONE]') continue;
    let ev;
    try { ev = JSON.parse(payload); } catch { continue; }
    const et = ev.type || '';
    if (et && !seen.has(et)) { seen.add(et); console.error(`event: ${et}`); }
    const item = ev.item || ev.output_item || ev.output || null;
    const check = (o) => {
      if (o && o.type === 'image_generation_call' && typeof o.result === 'string' && o.result.length > 1000) {
        b64 = o.result;
        return true;
      }
      return false;
    };
    if (check(item)) break;
    if (Array.isArray(ev.output)) { for (const o of ev.output) if (check(o)) break; }
    if (b64) break;
  }
  if (b64) break;
}
if (!b64) {
  console.error('No image_generation_call result in stream');
  process.exit(1);
}
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(JSON.stringify({ file: out, bytes: Buffer.from(b64, 'base64').length }));
