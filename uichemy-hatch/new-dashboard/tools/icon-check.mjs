// Free-icon gate. The Hugeicons MCP server searches the FULL 59k catalogue and
// returns no free/pro flag, so ~15-30% of what it suggests cannot be shipped in
// UiChemy (GPLv3 on wordpress.org — Pro icons are not redistributable).
//
// Run every candidate through this before importing it:
//   node tools/icon-check.mjs square-round-corner border-inner angle rotate-left-01
//   node tools/icon-check.mjs SquareRoundCornerIcon BorderInnerIcon
//
// Accepts kebab-case (what the MCP returns) or PascalCase *Icon names.
// Exit code 1 if any candidate is missing from the free package.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'node_modules/@hugeicons/core-free-icons/dist/esm');

const FREE = new Set(
  readdirSync(DIR).filter((f) => f.endsWith('Icon.js')).map((f) => f.replace('.js', '')),
);

const toPascal = (s) =>
  /Icon$/.test(s) && /[A-Z]/.test(s)
    ? s
    : s.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') + 'Icon';

const names = process.argv.slice(2);
if (!names.length) {
  console.log(`free icons available: ${FREE.size}\n`);
  console.log('usage: node tools/icon-check.mjs <name> [name...]');
  process.exit(0);
}

let bad = 0;
for (const raw of names) {
  const n = toPascal(raw);
  if (FREE.has(n)) {
    console.log(`  FREE   ${raw.padEnd(28)} → import { ${n} } from '@hugeicons/core-free-icons';`);
  } else {
    bad++;
    // Offer near matches so a rejected candidate is actionable.
    const stem = n.replace(/Icon$/, '').replace(/\d+$/, '');
    const near = [...FREE].filter((f) => f.startsWith(stem.slice(0, Math.max(4, stem.length - 4)))).slice(0, 4);
    console.log(`  NOT FREE  ${raw.padEnd(26)}${near.length ? ` — closest free: ${near.join(', ')}` : ' — no near match'}`);
  }
}
console.log(`\n${names.length - bad}/${names.length} usable. ${bad ? 'Do NOT import the NOT FREE ones.' : 'All clear.'}`);
process.exit(bad ? 1 : 0);
