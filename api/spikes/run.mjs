// Usage: node spikes/run.mjs <worker-url> a|e|h   (prints status and wall time per call)
const [base, which] = process.argv.slice(2);
const pct = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
async function many(path, n = 20) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    const r = await fetch(base + path);
    const body = await r.text();
    out.push({ status: r.status, ms: Math.round(performance.now() - t), body: body.slice(0, 80) });
  }
  const ok = out.filter((o) => o.status === 200).length;
  const ms = out.map((o) => o.ms);
  console.log(`${path.padEnd(32)} ok ${ok}/${n}  p50 ${pct(ms, 50)}ms  p95 ${pct(ms, 95)}ms  ${out.find((o) => o.status !== 200)?.body ?? ''}`);
}
if (which === 'a') {
  await many('/a/bcrypt');
  for (const it of [100000, 300000, 600000, 1000000]) await many(`/a/pbkdf2?iter=${it}`);
  for (const [m, t] of [[19456, 2], [12288, 3], [65536, 3]]) await many(`/a/argon2?m=${m}&t=${t}`);
}
if (which === 'e') await many('/e/ping');
if (which === 'h') {
  for (const p of ['/', '/admin/assets/app.js', '/admin/users/42', '/admin/', '/api/v1/x']) {
    const r = await fetch(base + p);
    console.log(p.padEnd(24), r.status, (await r.text()).slice(0, 40).replace(/\n/g, ' '));
  }
}
