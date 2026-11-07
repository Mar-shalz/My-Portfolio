import assert from 'node:assert/strict';
import test from 'node:test';
import { createDraftStore } from '../admin/drafts.js';
function memory() {
  const entries = new Map();
  return { get length() { return entries.size; }, key: i => [...entries.keys()][i], getItem: k => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, v), removeItem: k => entries.delete(k) };
}
let serial = 0;
const editor = (storage, session = memory()) => createDraftStore({ storage: () => storage, session: () => session, id: () => String(++serial) });
const content = name => ({ _rev: 7, site: { name }, projects: [{ id: 'project', cover: '/uploads/keep.jpg' }] });
test('refresh and reopened tabs recover the entire unpublished draft and original revision', () => {
  const storage = memory(), session = memory(), first = editor(storage, session);
  first.save(content('Keep every edit'), 7, 'github');
  const refreshed = editor(storage, session), saved = refreshed.current('github');
  assert.deepEqual(saved.content, content('Keep every edit'));
  refreshed.restore(saved);
  assert.equal(storage.length, 1, 'Refresh does not accumulate duplicate drafts');
  const reopened = editor(storage), recovered = reopened.list('github')[0];
  reopened.restore(recovered);
  assert.equal(reopened.current('github').rev, 7, 'Recovery never rebases onto a newer live version');
  assert.deepEqual(reopened.current('github').content, content('Keep every edit'));
  reopened.clear();
  assert.equal(storage.length, 0);
});
test('independent and duplicated tabs cannot overwrite or clear each other’s edits', () => {
  const storage = memory(), session = memory(), first = editor(storage, session);
  first.save(content('First'), 7, 'github');
  const duplicate = editor(storage, session);
  duplicate.restore(duplicate.current('github'));
  first.save(content('New first'), 7, 'github');
  duplicate.save(content('New duplicate'), 7, 'github');
  assert.equal(storage.length, 2);
  assert.equal(first.current('github').content.site.name, 'New first');
  assert.equal(duplicate.current('github').content.site.name, 'New duplicate');
  first.clear();
  assert.equal(storage.length, 1);
  assert.equal(duplicate.current('github').content.site.name, 'New duplicate');
  const second = editor(storage);
  second.save(content('Independent'), 7, 'github');
  duplicate.clear();
  assert.equal(second.current('github').content.site.name, 'Independent');
});
test('chooser cannot discard or recover a record changed since it was displayed', () => {
  const storage = memory(), a = editor(storage);
  a.save(content('Before'), 7, 'local');
  const snapshot = a.list('local')[0];
  a.save(content('After'), 7, 'local');
  assert.throws(() => a.discard(snapshot), /changed in another tab/);
  assert.throws(() => a.restore(snapshot), /changed in another tab/);
  assert.equal(a.current('local').content.site.name, 'After');
});
test('storage failure preserves the last saved copy, and blocked session storage still allows reopening', () => {
  const storage = memory(), session = () => { throw new Error('Session blocked'); };
  const a = createDraftStore({ storage: () => storage, session, id: () => String(++serial) });
  a.save(content('Safe'), 7, 'github');
  const write = storage.setItem;
  storage.setItem = () => { throw new Error('Quota full'); };
  assert.throws(() => a.save(content('Pending'), 7, 'github'), /Quota/);
  assert.equal(editor(storage).list('github')[0].content.site.name, 'Safe');
  storage.setItem = write;
  assert.throws(() => createDraftStore({ storage: session }).list('github'), /blocked/);
});
test('invalid records are ignored without deletion and local drafts stay separate from live drafts', () => {
  const storage = memory(), a = editor(storage);
  storage.setItem('portfolio-cms:draft:v1:invalid', '{broken');
  a.save(content('Local only'), 7, 'local');
  assert.equal(a.list('github').length, 0);
  assert.equal(a.list('local').length, 1);
  assert.equal(storage.getItem('portfolio-cms:draft:v1:invalid'), '{broken');
});
