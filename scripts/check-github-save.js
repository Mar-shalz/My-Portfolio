// Run with: node --test scripts/check-github-save.js. No network or real content is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGitHub } from '../lib/github.js';
import { createStore } from '../lib/store.js';

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-github-save-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const original = { _rev: 0, site: { name: 'Original' }, projects: [] };
  const file = path.join(dataDir, 'content.json');
  fs.writeFileSync(file, JSON.stringify(original));
  const remote = { doc: structuredClone(original), sha: 'blob-0', commits: [], requests: [], failPut: null, failGet: false, delayNextGet: null };
  const versions = new Map();
  function record() {
    const sha = String(remote.doc._rev + 1).padStart(40, '0');
    versions.set(sha, structuredClone(remote.doc));
    remote.commits.unshift({ sha, commit: { message: `Version ${remote.doc._rev}`, committer: { date: '2026-01-01T00:00:00Z' } } });
  }
  record();
  const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://github.invalid');
    assert.equal(options.headers.Authorization, 'Bearer fixture-only');
    const body = options.body && JSON.parse(options.body);
    remote.requests.push({ method: options.method, path: url.pathname, body });
    if (url.pathname.endsWith('/commits')) return response(200, structuredClone(remote.commits));
    assert.equal(url.pathname, '/repos/fixture/portfolio/contents/data/content.json');
    if (options.method === 'GET') {
      if (remote.failGet) throw new Error('Simulated read failure');
      const ref = url.searchParams.get('ref');
      const doc = ref === 'main' ? remote.doc : versions.get(ref);
      if (!doc) return response(404, {});
      const buf = Buffer.from(JSON.stringify(doc));
      const sha = remote.sha;
      const delay = remote.delayNextGet;
      remote.delayNextGet = null;
      if (delay) await delay;
      return response(200, { sha, size: buf.length, content: buf.toString('base64') });
    }
    assert.equal(options.method, 'PUT');
    assert.equal(body.branch, 'main');
    if (remote.failPut === 'network') throw new Error('Simulated connection failure');
    if (remote.failPut) return response(remote.failPut, { message: remote.failPut === 422 ? 'sha does not match' : 'Rejected' });
    if (body.sha !== remote.sha) return response(409, { message: 'sha does not match' });
    remote.doc = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    remote.sha = `blob-${remote.doc._rev}`;
    record();
    return response(200, { content: { sha: remote.sha }, commit: { sha: remote.commits[0].sha } });
  });
  const github = createGitHub({ token: 'fixture-only', repo: 'fixture/portfolio', api: 'https://github.invalid' });
  const store = createStore({ dataDir, bundledDir: dataDir, github });
  return { store, remote, file };
}

function renamed(doc, name) {
  const draft = structuredClone(doc);
  draft.site.name = name;
  return draft;
}

test('GitHub save round-trips the full document and history restores it as a new revision', async t => {
  const { store, remote, file } = fixture(t);
  const original = await store.latest();
  const draft = renamed(original, 'Saved through GitHub');
  draft.hero.intro = 'Keep the rest of this draft too.';
  const before = structuredClone(draft);
  const saved = await store.save(draft, 0);
  assert.equal(saved._rev, 1);
  assert.deepEqual(await store.latest(), saved);
  assert.deepEqual(store.read(), saved);
  assert.deepEqual(remote.doc, saved);
  assert.deepEqual(draft, before, 'Saving must not mutate the caller’s draft');
  assert.equal(remote.requests.find(r => r.method === 'PUT').body.sha, 'blob-0');
  const backups = await store.listBackups();
  assert.equal(backups.length, 1);
  const restored = await store.restore(backups[0].name);
  assert.equal(restored._rev, 2);
  assert.equal(restored.site.name, 'Original');
  assert.equal(restored.hero.intro, undefined);
  assert.deepEqual(await store.latest(), restored);
  assert.equal(remote.commits.length, 3, 'Restore must preserve the prior commits');
  assert.equal(JSON.parse(fs.readFileSync(file))._rev, 0, 'GitHub mode must leave the deployed file untouched');
});

test('competing GitHub saves use the same SHA, reject the loser, and reject later stale revisions', async t => {
  const { store, remote } = fixture(t);
  const original = await store.latest();
  const first = renamed(original, 'Winner');
  const stale = renamed(original, 'Keep this unsaved draft');
  const results = await Promise.allSettled([store.save(first, 0), store.save(stale, 0)]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.status, 409);
  const puts = remote.requests.filter(r => r.method === 'PUT');
  assert.deepEqual(puts.map(r => r.body.sha), ['blob-0', 'blob-0']);
  assert.equal(remote.doc.site.name, 'Winner');
  assert.equal(store.read().site.name, 'Winner');
  assert.equal(stale.site.name, 'Keep this unsaved draft');
  assert.equal(stale._rev, 0);
  await assert.rejects(store.save(stale, 0), { status: 409 });
  assert.equal(remote.requests.filter(r => r.method === 'PUT').length, 2, 'A stale revision must fail before another write');
  assert.equal(remote.commits.length, 2);
});

for (const failure of ['network', 401, 403, 409, 422]) {
  test(`GitHub ${failure} failure leaves the saved content, cache and draft intact`, async t => {
    const { store, remote } = fixture(t);
    const original = structuredClone(store.read());
    const draft = renamed(original, 'Unpublished edit');
    const before = structuredClone(draft);
    remote.failPut = failure;
    await assert.rejects(store.save(draft, 0), error => {
      if (failure === 'network') return /Simulated connection/.test(error.message);
      assert.equal(error.status, [409, 422].includes(failure) ? 409 : 502);
      assert.equal(error.expose, true);
      return true;
    });
    assert.equal(remote.doc.site.name, 'Original');
    assert.equal(remote.doc._rev, 0);
    assert.deepEqual(store.read(), original);
    assert.deepEqual(draft, before);
    remote.failPut = null;
    const saved = await store.save(draft, 0);
    assert.equal(saved._rev, 1);
    assert.equal((await store.latest()).site.name, 'Unpublished edit');
  });
}

test('public reads fetch current GitHub content immediately, share an in-flight read and refresh after 30 seconds', async t => {
  const { store, remote, file } = fixture(t);
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  assert.equal(store.read().site.name, 'Original');
  remote.doc = renamed(remote.doc, 'Current public content');
  remote.doc._rev = 4;
  let release;
  remote.delayNextGet = new Promise(resolve => { release = resolve; });
  const readers = [store.published(), store.published(), store.published()];
  assert.equal(remote.requests.length, 1, 'Visitors must share one pending GitHub read');
  release();
  for (const doc of await Promise.all(readers)) {
    assert.equal(doc.site.name, 'Current public content');
    assert.equal(doc._rev, 4);
  }
  remote.doc = renamed(remote.doc, 'Newer public content');
  remote.doc._rev = 5;
  now += 29_999;
  assert.equal((await store.published())._rev, 4);
  assert.equal(remote.requests.length, 1);
  now += 2;
  assert.equal((await store.published()).site.name, 'Newer public content');
  assert.equal(remote.requests.length, 2);
  assert(remote.requests.every(r => r.method === 'GET'), 'Public reads must never write');
  assert.equal(JSON.parse(fs.readFileSync(file))._rev, 0);
});

test('failed public reads use the bundle or last good content and retry after 30 seconds', async t => {
  const { store, remote } = fixture(t);
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  remote.doc = renamed(remote.doc, 'Current public content');
  remote.doc._rev = 4;
  remote.failGet = true;
  assert.equal((await store.published()).site.name, 'Original');
  assert.equal(remote.requests.length, 1);
  remote.failGet = false;
  now += 29_999;
  assert.equal((await store.published()).site.name, 'Original');
  assert.equal(remote.requests.length, 1, 'A failed read must not be retried on every visitor');
  now += 2;
  assert.equal((await store.published())._rev, 4);
  assert.equal(remote.requests.length, 2);
  remote.failGet = true;
  now += 30_001;
  assert.equal((await store.published())._rev, 4, 'An outage must not roll back to the older bundle');
  assert.equal((await store.published())._rev, 4);
  assert.equal(remote.requests.length, 3);
  remote.failGet = false;
  remote.doc._rev = 5;
  now += 30_001;
  assert.equal((await store.published())._rev, 5);
  assert(remote.requests.every(r => r.method === 'GET'));
});

test('a successful save warms the public cache without a second GitHub fetch', async t => {
  const { store, remote } = fixture(t);
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const saved = await store.save(renamed(store.read(), 'Just published'), 0);
  const count = remote.requests.length;
  remote.failGet = true;
  assert.deepEqual(await store.published(), saved);
  assert.equal(remote.requests.length, count);
  now += 30_001;
  assert.deepEqual(await store.published(), saved);
  assert.equal(remote.requests.length, count + 1);
});

test('an old public read completing after a save cannot roll the saved revision back', async t => {
  const { store, remote } = fixture(t);
  const draft = renamed(store.read(), 'Newly saved winner');
  let release;
  remote.delayNextGet = new Promise(resolve => { release = resolve; });
  const pending = store.published();
  const saved = await store.save(draft, 0);
  assert.equal(saved._rev, 1);
  release();
  assert.deepEqual(await pending, saved);
  assert.deepEqual(await store.published(), saved);
  assert.deepEqual(store.read(), saved);
  assert.equal(remote.doc.site.name, 'Newly saved winner');
});

test('local and read-only public reads use their existing content without GitHub access', async t => {
  const { file, remote } = fixture(t);
  const dataDir = path.dirname(file);
  for (const readOnly of [false, true]) {
    const store = createStore({ dataDir, bundledDir: dataDir, readOnly });
    assert.deepEqual(await store.published(), store.read());
  }
  assert.equal(remote.requests.length, 0);
});
