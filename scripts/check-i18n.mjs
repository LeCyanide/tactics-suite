/**
 * Checks the translations against the source.
 *
 * Every string the code passes to t(), tn() or N_() is a key; each language
 * must translate all of them, and should not carry keys nobody uses any more.
 * Placeholders ({name}) must survive translation unchanged.
 *
 *   node scripts/check-i18n.mjs            report, exit 1 on a problem
 *   node scripts/check-i18n.mjs --keys     print every key, one per line (JSON)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCES = ['src', 'electron'];
const SKIP = new Set([path.join(root, 'src', 'i18n')]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP.has(full)) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** A single- or double-quoted JS string literal, unescaped. */
const LIT = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`;
const unescape = (s) => s.replace(/\\(.)/g, '$1');

const keys = new Map(); // key -> first file:line
const plurals = new Set();
function add(key, file, src, index) {
  if (!keys.has(key)) keys.set(key, `${path.relative(root, file)}:${src.slice(0, index).split('\n').length}`);
}

for (const file of SOURCES.flatMap((d) => walk(path.join(root, d)))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(new RegExp(String.raw`\b(?:t|tr|tIn\([^,]+,)\s*\(\s*(?:${LIT})`, 'g'))) {
    add(unescape(m[1] ?? m[2]), file, src, m.index);
  }
  for (const m of src.matchAll(new RegExp(String.raw`\bN_\(\s*(?:${LIT})`, 'g'))) add(unescape(m[1] ?? m[2]), file, src, m.index);
  for (const m of src.matchAll(new RegExp(String.raw`\btn\([^,]+,\s*(?:${LIT})\s*,\s*(?:${LIT})`, 'g'))) {
    const other = unescape(m[3] ?? m[4]);
    add(other, file, src, m.index);
    plurals.add(other);
  }
}

// The dictionaries are TypeScript; bundle them to read them.
const out = path.join(root, 'node_modules', '.i18n-dicts.mjs');
await build({
  stdin: { contents: `export { DICTIONARIES, KEY_NAMES } from './src/i18n/core';`, resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
});
const { DICTIONARIES, KEY_NAMES } = await import(`file://${out}?${Date.now()}`);
for (const k of KEY_NAMES) keys.set(`key:${k}`, 'src/i18n/core.ts (KEY_NAMES)');

if (process.argv.includes('--keys')) {
  console.log(JSON.stringify([...keys.keys()], null, 1));
  process.exit(0);
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
let problems = 0;
for (const [lang, dict] of Object.entries(DICTIONARIES)) {
  const missing = [...keys.keys()].filter((k) => !(k in dict));
  const unused = Object.keys(dict).filter((k) => !keys.has(k));
  const broken = [];
  for (const [k, v] of Object.entries(dict)) {
    if (!keys.has(k)) continue;
    const forms = typeof v === 'string' ? [v] : Object.values(v);
    if (typeof v !== 'string' && !('other' in v)) broken.push(`${k}: plural without "other"`);
    const want = placeholders(k).replace(/(^|,)n(?=,|$)/, '$1').replace(/^,|,$/g, '');
    for (const f of forms) {
      const got = placeholders(f).replace(/(^|,)n(?=,|$)/, '$1').replace(/^,|,$/g, '');
      if (got !== want) broken.push(`${k} → ${f}: placeholders {${got}} instead of {${want}}`);
    }
  }
  for (const k of missing) console.log(`${lang}: missing  ${JSON.stringify(k)}  (${keys.get(k)})`);
  for (const k of unused) console.log(`${lang}: unused   ${JSON.stringify(k)}`);
  for (const b of broken) console.log(`${lang}: broken   ${b}`);
  problems += missing.length + unused.length + broken.length;
  console.log(`${lang}: ${keys.size - missing.length}/${keys.size} translated`);
}
process.exit(problems ? 1 : 0);
