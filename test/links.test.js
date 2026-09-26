// SwiftLink test suite — run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'swiftlink-')), 'test.db');
const PORT = 4123;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

async function req(p, opts = {}) {
  const res = await fetch(BASE + p, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body, headers: res.headers };
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE + '/api/links');
      return;
    } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

after(() => { server.kill(); });

test('creates a short link with auto-generated code', async () => {
  const { status, body } = await req('/api/links', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.com/article' }),
  });
  assert.equal(status, 201);
  assert.match(body.code, /^[A-Za-z0-9]{6}$/);
  assert.equal(body.url, 'https://example.com/article');
  assert.ok(body.shortUrl.endsWith('/' + body.code));
});

test('creates a link with a custom alias', async () => {
  const { status, body } = await req('/api/links', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.org/', alias: 'my-alias_1' }),
  });
  assert.equal(status, 201);
  assert.equal(body.code, 'my-alias_1');
});

test('rejects duplicate aliases with 409', async () => {
  const payload = { url: 'https://example.com/other', alias: 'dupe-alias' };
  const first = await req('/api/links', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(first.status, 201);
  const second = await req('/api/links', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already in use/i);
});

test('rejects invalid URLs with 400', async () => {
  const bad = await req('/api/links', {
    method: 'POST',
    body: JSON.stringify({ url: 'not-a-url' }),
  });
  assert.equal(bad.status, 400);
});

test('redirects with 302 and records clicks', async () => {
  const { body } = await req('/api/links', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.net/target', alias: 'redir-test' }),
  });
  const res = await fetch(BASE + '/redir-test', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://example.net/target');
  await fetch(BASE + '/redir-test', { redirect: 'manual' });

  const stats = await req('/api/links/redir-test/stats');
  assert.equal(stats.status, 200);
  assert.equal(stats.body.totalClicks, 2);
  assert.equal(stats.body.clicksPerDay.length, 14);
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = stats.body.clicksPerDay.find((d) => d.date === today);
  assert.ok(todayRow && todayRow.clicks >= 2);
});

test('returns 404 for unknown short codes', async () => {
  const res = await fetch(BASE + '/nope-not-here', { redirect: 'manual' });
  assert.equal(res.status, 404);
  const stats = await req('/api/links/nope-not-here/stats');
  assert.equal(stats.status, 404);
});

test('lists links with click counts', async () => {
  const { status, body } = await req('/api/links');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  const found = body.find((l) => l.code === 'redir-test');
  assert.ok(found);
  assert.equal(found.clicks, 2);
});

test('serves a PNG QR code', async () => {
  const { status, body, headers } = await req('/api/links/redir-test/qr');
  assert.equal(status, 200);
  assert.ok(headers.get('content-type').includes('image/png'));
  assert.ok(body.length > 100);
  // PNG magic bytes
  assert.deepEqual([...body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('deletes a link', async () => {
  const del = await req('/api/links/my-alias_1', { method: 'DELETE' });
  assert.equal(del.status, 204);
  const gone = await fetch(BASE + '/my-alias_1', { redirect: 'manual' });
  assert.equal(gone.status, 404);
  const again = await req('/api/links/my-alias_1', { method: 'DELETE' });
  assert.equal(again.status, 404);
});

test('stats include top referrers', async () => {
  await fetch(BASE + '/redir-test', {
    redirect: 'manual',
    headers: { Referer: 'https://google.com/search' },
  });
  const { body } = await req('/api/links/redir-test/stats');
  const ref = body.topReferrers.find((r) => r.referrer.includes('google.com'));
  assert.ok(ref && ref.clicks >= 1);
});
