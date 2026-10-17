// Release guard: fail if the production bundle contains test/dev hooks or
// secrets. Run after `npm run build`. Scans dist/ text assets.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const FORBIDDEN = ['__PLUMBER__', 'lastCodeFor', 'VITE_TEST_HOOKS', 'auth.json', 'refresh_token'];
const TEXT_EXT = /\.(js|mjs|css|html|json|webmanifest|map)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let failed = false;
try {
  for (const f of walk(DIST)) {
    if (!TEXT_EXT.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) {
        console.error(`FAIL: "${needle}" found in ${f}`);
        failed = true;
      }
    }
  }
} catch (err) {
  console.error(`FAIL: cannot scan ${DIST}: ${err.message}`);
  process.exit(1);
}

if (failed) process.exit(1);
console.log(`OK: release bundle has no test hooks/secrets (${DIST})`);
