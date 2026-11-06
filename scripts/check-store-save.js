// Run with: node --test scripts/check-store-save.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStore } from '../lib/store.js';

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-save-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, 'content.json');
  fs.writeFileSync(file, JSON.stringify({ _rev: 0, site: { name: 'Original' }, projects: [] }));
  const options = { dataDir, bundledDir: dataDir };
  return { dataDir, file, options, store: createStore(options) };
}

function renamed(content, name) {
  const next = structuredClone(content);
  next.site.name = name;
  return next;
}

test('concurrent saves accept one revision, preserve its content, and keep restorable backups', async (t) => {
  const { dataDir, file, store } = fixture(t);
  const original = structuredClone(store.read());
  const first = renamed(original, 'Accepted edit');
  const second = renamed(original, 'Stale edit');

  const results = await Promise.allSettled([store.save(first, 0), store.save(second, 0)]);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.status, 409);
  assert.equal(results[0].value._rev, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).site.name, 'Accepted edit');
  assert.equal(store.read().site.name, 'Accepted edit');

  const backups = await store.listBackups();
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'backups', backups[0].name), 'utf8')), original);

  const next = await store.save(renamed(results[0].value, 'Next edit'), 1);
  assert.equal(next._rev, 2);
  const restored = await store.restore(backups[0].name);
  assert.equal(restored._rev, 3);
  assert.equal(restored.site.name, 'Original');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), restored);
  const beforeRestore = (await store.listBackups()).find((backup) => backup.rev === 2);
  assert.ok(beforeRestore);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'backups', beforeRestore.name), 'utf8')), next);
});

test('a second store cannot overwrite a newer revision using its cached content', async (t) => {
  const { options, file, store } = fixture(t);
  const other = createStore(options);
  const stale = structuredClone(other.read());
  await store.save(renamed(store.read(), 'Saved elsewhere'), 0);

  await assert.rejects(other.save(renamed(stale, 'Stale overwrite'), 0), { status: 409 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).site.name, 'Saved elsewhere');
  const latest = await other.latest();
  assert.equal(latest._rev, 1);
  assert.equal(latest.site.name, 'Saved elsewhere');
  assert.equal((await other.save(renamed(latest, 'Updated safely'), latest._rev))._rev, 2);
  assert.equal((await store.latest()).site.name, 'Updated safely');
});

test('invalid content leaves the saved file, cache, and backups intact', async (t) => {
  const { file, store } = fixture(t);
  const original = structuredClone(store.read());
  const bytes = fs.readFileSync(file, 'utf8');

  await assert.rejects(store.save(renamed(original, ''), 0), { status: 422 });
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  assert.deepEqual(store.read(), original);
  assert.deepEqual(await store.listBackups(), []);
});

test('a failed file replacement retains the saved content and does not advance the cache', async (t) => {
  const { file, store } = fixture(t);
  const original = structuredClone(store.read());
  const bytes = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  const replacement = t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === file) throw Object.assign(new Error('Simulated disk failure'), { code: 'EIO' });
    return rename(from, to);
  });

  await assert.rejects(store.save(renamed(original, 'Unsaved edit'), 0), { code: 'EIO' });
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  assert.deepEqual(store.read(), original);
  assert.equal((await store.listBackups()).length, 1);

  replacement.mock.restore();
  const retried = await store.save(renamed(original, 'Retried edit'), 0);
  assert.equal(retried._rev, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).site.name, 'Retried edit');
});
