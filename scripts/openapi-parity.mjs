// Compares the generated contract (packages/api-types/openapi.json) with the legacy one (docs/legacy-openapi.json).
// Rules: every legacy path+method must exist; request bodies must have the same content type and required fields;
// the `data` object of every 2xx response must keep all legacy required fields (extra fields are allowed).
// Each difference must be listed in docs/CONTRACT-DIFFS.md as a table row starting with `<key>`; an unlisted
// difference fails, and so does a listed one that no longer exists. Exit code 1 on failure.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const legacy = read('docs/legacy-openapi.json');
const current = read('packages/api-types/openapi.json');

const norm = (p) => p.replace(/\{[^}]+\}/g, '{}');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const ops = (doc) => {
  const m = new Map();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) if (item[method]) m.set(`${method.toUpperCase()} ${norm(path)}`, item[method]);
  }
  return m;
};

const deref = (doc, s) => {
  if (!s) return s;
  if (s.$ref) return deref(doc, doc.components.schemas[s.$ref.split('/').pop()]);
  if (s.allOf) return s.allOf.map((x) => deref(doc, x)).reduce((a, b) => ({ ...a, ...b, required: [...(a.required ?? []), ...(b.required ?? [])], properties: { ...a.properties, ...b.properties } }), {});
  if (s.anyOf) return deref(doc, s.anyOf.find((x) => x.type !== 'null') ?? s.anyOf[0]);
  return s;
};
const jsonOf = (content) => content?.['application/json']?.schema ?? Object.values(content ?? {})[0]?.schema;

const bodyShape = (doc, op) => {
  const c = op.requestBody?.content;
  if (!c) return null;
  const type = Object.keys(c)[0];
  const s = deref(doc, c[type].schema);
  return { type, required: [...(s?.required ?? [])].sort() };
};
const dataRequired = (doc, op) => {
  const code = Object.keys(op.responses ?? {}).find((c) => c.startsWith('2'));
  const body = deref(doc, jsonOf(op.responses?.[code]?.content));
  let data = deref(doc, body?.properties?.data);
  if (data?.type === 'array' || data?.items) data = deref(doc, data.items);
  return new Set(data?.required ?? []);
};

const a = ops(legacy);
const b = ops(current);
const diffs = new Map();
for (const [key, op] of a) {
  const now = b.get(key);
  if (!now) {
    diffs.set(`missing ${key}`, 'legacy operation absent');
    continue;
  }
  const lb = bodyShape(legacy, op);
  const nb = bodyShape(current, now);
  if (JSON.stringify(lb) !== JSON.stringify(nb)) diffs.set(`body ${key}`, `legacy ${JSON.stringify(lb)} now ${JSON.stringify(nb)}`);
  const need = [...dataRequired(legacy, op)].filter((f) => !dataRequired(current, now).has(f));
  if (need.length) diffs.set(`response ${key}`, `no longer required: ${need.join(', ')}`);
}
for (const key of b.keys()) {
  if (a.has(key)) continue;
  // Laravel's apiResource accepts PUT and PATCH but the legacy spec lists PUT only: the PATCH twin is not a difference.
  if (key.startsWith('PATCH ') && a.has(key.replace('PATCH ', 'PUT '))) continue;
  diffs.set(`extra ${key}`, 'not in legacy');
}

const doc = readFileSync(resolve(root, 'docs/CONTRACT-DIFFS.md'), 'utf8');
const listed = new Set([...doc.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]));

const unlisted = [...diffs.keys()].filter((k) => !listed.has(k));
const stale = [...listed].filter((k) => !diffs.has(k));
for (const k of unlisted) console.error(`UNLISTED  ${k}  (${diffs.get(k)})`);
for (const k of stale) console.error(`STALE     ${k}  (listed in docs/CONTRACT-DIFFS.md but no longer a difference)`);
console.log(`parity: ${a.size} legacy operations, ${b.size} current, ${diffs.size} differences, ${listed.size} listed`);
if (unlisted.length || stale.length) {
  console.error('parity: FAILED');
  process.exit(1);
}
console.log('parity: ok');
