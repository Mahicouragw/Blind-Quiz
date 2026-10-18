// Pre-flight integrity guard for the blind-quiz-api Edge Function source.
//
// The production incident was a concatenated/duplicated deployment:
//   Uncaught SyntaxError: Identifier 'createClient' has already been declared
//   at index.ts:680:10
// while the repository source is a single ~87-line module. This script fails
// loudly if the file ever stops being exactly one self-consistent module, so a
// broken bundle can never be uploaded again.
//
// It is deliberately dependency-free (no TypeScript install needed).

import { readFile } from 'node:fs/promises';

const TARGET = new URL('../supabase/functions/blind-quiz-api/index.ts', import.meta.url);
const MAX_LINES = 200; // the reviewed module is ~87 lines; duplication shows up immediately

const problems = [];
const assert = (ok, message) => { if (!ok) problems.push(message); };

const source = await readFile(TARGET, 'utf8');
const lines = source.split('\n');

// --- 1. Size / duplication ---------------------------------------------------
assert(lines.length <= MAX_LINES, `index.ts is ${lines.length} lines, expected at most ${MAX_LINES} (source looks concatenated)`);

const imports = source.match(/^\s*import\s.+$/gm) ?? [];
assert(imports.length === 1, `expected exactly 1 import statement, found ${imports.length}`);
assert((source.match(/^\s*import\s*\{\s*createClient\s*\}/gm) ?? []).length === 1,
  'createClient must be imported exactly once');
assert((source.match(/\bcreateClient\s*\(/g) ?? []).length === 1,
  'createClient must be called exactly once (one admin client)');
assert((source.match(/\bDeno\.serve\s*\(/g) ?? []).length === 1,
  'Deno.serve must be registered exactly once');
assert((source.match(/^const\s+admin\s*=/gm) ?? []).length === 1,
  'the admin client must be created exactly once');

// --- 2. Duplicate top-level identifiers --------------------------------------
// This is the precise failure mode seen in production.
const topLevel = new Map();
for (const [index, line] of lines.entries()) {
  const match = /^(?:export\s+)?(?:const|let|var|function|async\s+function|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
  if (!match) continue;
  const name = match[1];
  if (topLevel.has(name)) problems.push(`duplicate top-level declaration '${name}' at lines ${topLevel.get(name)} and ${index + 1}`);
  else topLevel.set(name, index + 1);
}
assert(topLevel.has('handler'), 'the request handler declaration is missing');
assert(source.includes('Deno.serve(handler)'), 'Deno.serve must be wired to handler');

// --- 3. Real ESM parse check -------------------------------------------------
// `node --check file.ts` parses as CommonJS and silently misses duplicate ESM
// imports, so strip the types first and parse the result as a module. This
// reproduces the exact production failure:
//   SyntaxError: Identifier 'createClient' has already been declared
let parsed = false;
try {
  const { stripTypeScriptTypes } = await import('node:module');
  const { writeFile, rm } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const tmp = new URL('../.function-parse-check.mjs', import.meta.url);
  await writeFile(tmp, stripTypeScriptTypes(source, { mode: 'strip' }));
  try {
    await run(process.execPath, ['--no-warnings', '--check', tmp.pathname]);
    parsed = true;
  } catch (error) {
    const detail = String(error.stderr || error.message).split('\n').filter(l => /SyntaxError|Error:/.test(l))[0] ?? 'parse failure';
    problems.push(`index.ts is not a valid ES module: ${detail.trim()}`);
  } finally {
    await rm(tmp, { force: true });
  }
} catch {
  // Node without stripTypeScriptTypes: fall back to the structural checks above.
  console.warn('note: ESM parse check skipped (requires Node >= 22.13); structural checks still applied.');
}
if (parsed) console.log('  ESM parse: index.ts is a single valid ES module.');

// --- 4. Security invariants that must survive any redeploy --------------------
const required = [
  ['PBKDF2 answer hashing', /name:'PBKDF2'/],
  ['310000 PBKDF2 iterations', /iterations:310000/],
  ['constant-time comparison', /constantTimeEqual/],
  ['hashed session tokens only', /token_hash/],
  ['rate-limit RPC', /bq_consume_attempt/],
  ['server-side answer RPC', /bq_record_answer/],
  ['origin allowlist', /ALLOWED_ORIGINS/],
  ['publishable apikey check', /sb_publishable_/],
  ['generic signup rejection', /code:'name_taken'/],
  ['generic login rejection', /code:'invalid_credentials'/],
  ['rate limited response', /code:'rate_limited'/],
];
for (const [label, pattern] of required) assert(pattern.test(source), `missing security behaviour: ${label}`);

// Never log or echo secret material.
const forbidden = [
  ['service-role key logging', /console\.(?:log|error)\([^)]*SECRET/],
  ['pepper logging', /console\.(log|error)\([^)]*PEPPER/],
  ['secret answer logging', /console\.(log|error)\([^)]*\banswer\b/],
  ['session token logging', /console\.(log|error)\([^)]*\b(?:token|raw)\b/],
  ['authorization header logging', /console\.(log|error)\([^)]*[Aa]uthorization/],
  ['full error object logging', /console\.(?:log|error)\([^)]*(?:\berror\b|\berr\b)\s*\)/],
];
for (const [label, pattern] of forbidden) assert(!pattern.test(source), `unsafe logging detected: ${label}`);

// The function must never return stored hashes or salts to a client.
// Inspect only the response payloads (every `json(...)` call), not DB writes.
function balancedCalls(src, name) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(`${name}(`, from);
    if (at === -1) break;
    let depth = 0;
    let i = at + name.length;
    const start = i + 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(start, i));
    from = i + 1;
  }
  return out;
}
const payloads = balancedCalls(source, 'json');
assert(payloads.length >= 20, `expected the handler to build many JSON responses, found ${payloads.length}`);
for (const payload of payloads) {
  assert(!/\banswer_hash\b|\banswer_salt\b|\btoken_hash\b|\bSECRET\b|\bPEPPER\b/.test(payload),
    `response payload exposes sensitive material: ${payload.slice(0, 80)}…`);
}
const publicProfile = source.slice(source.indexOf('function publicProfile'), source.indexOf('async function handler'));
assert(publicProfile.length > 0 && !/answer_hash|answer_salt|token_hash|last_login_at/.test(publicProfile),
  'publicProfile must serialize progress fields only');

// --- 5. Report ---------------------------------------------------------------
if (problems.length) {
  console.error('FAIL: blind-quiz-api source integrity check');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`PASS: blind-quiz-api source is one clean ${lines.length - 1}-line module `
  + `(${imports.length} import, 1 createClient, 1 admin client, 1 Deno.serve), `
  + 'no duplicate declarations, security and logging invariants intact.');
