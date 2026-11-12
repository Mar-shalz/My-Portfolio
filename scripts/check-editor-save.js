import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createDraftStore } from '../admin/drafts.js';

// Run the shipped editor/API functions against delayed in-memory responses.
// No server, portfolio file or backup is modified by these checks.
const source = fs.readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const code = [
  source.match(/^const clone = .*;$/m)?.[0],
  source.match(/^const state = .*;$/m)?.[0],
  source.slice(source.indexOf('async function api('), source.indexOf('function toast(')),
  source.slice(source.indexOf('function markDirty('), source.indexOf('async function preview(')),
  'globalThis.editor = { state, markDirty, updateStatus, save };',
].join('\n');

function setup() {
  const requests = [], messages = [], routes = [];
  const entries = new Map();
  const storage = { getItem: k => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, v), removeItem: k => entries.delete(k), key: i => [...entries.keys()][i], get length() { return entries.size; } };
  let id = 0;
  const drafts = createDraftStore({ storage: () => storage, session: () => ({ getItem: () => null, setItem() {}, removeItem() {} }), id: () => String(++id) });
  const nodes = { '#status': {}, '#saveBtn': {} };
  let loginCount = 0;
  const context = vm.createContext({
    drafts,
    $: selector => nodes[selector],
    toast: (message, type) => messages.push({ message, type }),
    route: keepScroll => routes.push(keepScroll),
    timeAgo: () => 'just now',
    showLogin: () => { loginCount += 1; },
    fetch: (url, options) => new Promise((resolve, reject) => {
      requests.push({ url, options, payload: JSON.parse(options.body), resolve, reject });
    }),
  });
  vm.runInContext(code, context);
  const editor = context.editor;
  editor.state.content = {
    site: { name: 'Fixture' }, _rev: 4, updatedAt: '2026-01-01T00:00:00.000Z',
    home: { headline: 'Original headline' },
    projects: [{ id: 'first', slug: 'Original Slug', title: 'First project' }],
  };
  editor.state.rev = 4;
  editor.markDirty();
  return { ...editor, drafts, storage, entries, requests, messages, routes, nodes, get loginCount() { return loginCount; } };
}

function reply(request, { status = 200, error, slugs = {} } = {}) {
  const content = structuredClone(request.payload.content);
  for (const project of content.projects) {
    if (Object.hasOwn(slugs, project.id)) project.slug = slugs[project.id];
  }
  const data = status === 200
    ? { rev: request.payload.rev + 1, updatedAt: '2026-02-01T00:00:00.000Z', content }
    : { error };
  request.resolve({ status, ok: status === 200, json: async () => data });
}

// A completed unchanged draft adopts normalized fields and clears the dirty flag.
{
  const e = setup();
  const draft = e.state.content;
  const pending = e.save();
  assert.equal(e.nodes['#saveBtn'].disabled, true);
  assert.equal(e.nodes['#status'].textContent, 'Publishing…');
  assert.equal(e.requests[0].url, '/api/content');
  assert.equal(e.requests[0].options.method, 'PUT');
  assert.equal(e.requests[0].options.headers['X-CMS'], '1');
  reply(e.requests[0], { slugs: { first: 'original-slug' } });
  await pending;
  assert.equal(e.state.content, draft, 'Saving must preserve the existing draft object');
  assert.equal(e.state.rev, 5);
  assert.equal(draft._rev, 5);
  assert.equal(draft.updatedAt, '2026-02-01T00:00:00.000Z');
  assert.equal(draft.projects[0].slug, 'original-slug');
  assert.equal(e.state.dirty, false);
  assert.equal(e.state.saving, false);
  assert.equal(e.entries.size, 0, 'Only a successful publish clears the saved draft');
  assert.equal(e.nodes['#saveBtn'].disabled, true);
  assert.equal(e.routes.length, 1);
  assert.equal(e.messages[0].message, 'Published. Your site is updated.');
  await e.save();
  assert.equal(e.requests.length, 1, 'A clean draft must not trigger another request');
}

// Typing while publishing remains unpublished and a second publish uses the new revision.
{
  const e = setup();
  const pending = e.save();
  e.state.content.home.headline = 'Newer headline';
  e.markDirty();
  await e.save();
  assert.equal(e.requests.length, 1, 'Repeated publish must not overlap the pending request');
  assert.equal(e.requests[0].payload.content.home.headline, 'Original headline');
  reply(e.requests[0], { slugs: { first: 'original-slug' } });
  await pending;
  assert.equal(e.state.content.home.headline, 'Newer headline');
  assert.equal(e.state.content.projects[0].slug, 'original-slug');
  assert.equal(e.state.dirty, true);
  assert.equal(e.state.rev, 5);
  assert.equal(e.drafts.current('local').rev, 5);
  assert.equal(e.drafts.current('local').content.home.headline, 'Newer headline');
  assert.equal(e.nodes['#saveBtn'].disabled, false);
  assert.equal(e.nodes['#status'].textContent, 'Draft saved on this browser');
  assert.equal(e.routes.length, 0, 'The form must not rebuild while newer edits exist');
  assert.match(e.messages[0].message, /newer edits are still unpublished/);
  const next = e.save();
  assert.equal(e.requests[1].payload.rev, 5);
  assert.equal(e.requests[1].payload.content.home.headline, 'Newer headline');
  reply(e.requests[1]);
  await next;
  assert.equal(e.state.rev, 6);
  assert.equal(e.state.dirty, false);
  assert.equal(e.state.saving, false);
}

// A response cannot overwrite a slug typed after the request was sent.
{
  const e = setup();
  const pending = e.save();
  e.state.content.projects[0].slug = 'my-new-slug';
  e.markDirty();
  reply(e.requests[0], { slugs: { first: 'original-slug' } });
  await pending;
  assert.equal(e.state.content.projects[0].slug, 'my-new-slug');
  assert.equal(e.state.dirty, true);
}

// Project additions, removals and ordering made during publishing stay in the draft.
{
  const e = setup();
  e.state.content.projects.push({ id: 'second', slug: 'second', title: 'Second project' });
  const pending = e.save();
  e.state.content.projects.splice(0, 1);
  e.state.content.projects.unshift({ id: 'third', slug: 'third', title: 'New project' });
  e.markDirty();
  reply(e.requests[0], { slugs: { first: 'original-slug', second: 'second-normalized' } });
  await pending;
  assert.deepEqual(e.state.content.projects.map(p => p.id), ['third', 'second']);
  assert.equal(e.state.content.projects[0].slug, 'third');
  assert.equal(e.state.content.projects[1].slug, 'second-normalized');
  assert.equal(e.state.dirty, true);
}

// Network errors, validation failures, expired sessions and conflicts keep every edit.
for (const failure of ['network', 409, 400, 401]) {
  const e = setup();
  const pending = e.save();
  e.state.content.home.headline = 'Keep this draft';
  e.markDirty();
  const expected = structuredClone(e.state.content);
  if (failure === 'network') e.requests[0].reject(new Error('Connection interrupted'));
  else reply(e.requests[0], { status: failure, error: 'Publish rejected' });
  await pending;
  assert.deepEqual(e.state.content, expected);
  assert.equal(e.state.rev, 4);
  assert.equal(e.drafts.current('local').content.home.headline, 'Keep this draft');
  assert.equal(e.drafts.current('local').rev, 4);
  assert.equal(e.state.dirty, true);
  assert.equal(e.state.saving, false);
  assert.equal(e.nodes['#saveBtn'].disabled, false);
  assert.equal(e.messages[0].type, 'error');
  assert.equal(e.loginCount, failure === 401 ? 1 : 0);
  const retry = e.save();
  assert.equal(e.requests[1].payload.content.home.headline, 'Keep this draft');
  assert.equal(e.requests[1].payload.rev, 4);
  reply(e.requests[1]);
  await retry;
  assert.equal(e.state.dirty, false);
}

// A late response after a restore/sign-out cannot mutate or announce the old draft.
for (const replacement of [null, { _rev: 20, projects: [], home: { headline: 'Restored draft' } }]) {
  for (const fails of [false, true]) {
    const e = setup();
    const pending = e.save();
    e.state.content = replacement;
    e.state.rev = replacement?._rev ?? 0;
    e.state.dirty = Boolean(replacement);
    const expectedRev = e.state.rev;
    if (fails) e.requests[0].reject(new Error('An old request failed'));
    else reply(e.requests[0]);
    await pending;
    assert.equal(e.state.content, replacement);
    assert.equal(e.state.rev, expectedRev);
    assert.equal(e.state.dirty, Boolean(replacement));
    assert.equal(e.state.saving, false);
    assert.equal(e.messages.length, 0);
    assert.equal(e.routes.length, 0);
  }
}

console.log('Editor save checks passed: in-flight edits/slugs/project changes, repeat publishing, retries, conflicts, session expiry and replaced drafts. No real content was written.');

// Storage failures cannot be announced as safely saved.
{
  const e = setup();
  e.storage.setItem = () => { throw new Error('Quota exhausted'); };
  e.state.content.home.headline = 'Not yet stored';
  e.markDirty();
  assert.equal(e.state.draftSaved, false);
  assert.equal(e.nodes['#status'].textContent, 'Draft not saved on this browser');
  assert.equal(e.drafts.current('local').content.home.headline, 'Original headline');
  assert.match(e.messages[0].message, /Autosave could not/);
}

// Keyboard and drag ordering share one bounded operation and retain the whole project object.
{
  const arr = [{ id: 'a', blocks: ['keep'] }, { id: 'b' }, { id: 'c' }];
  let changes = 0, draws = 0, focused;
  const list = { children: arr.map((_, i) => ({ querySelector: () => ({ focus() { focused = i; } }) })) };
  const start = source.indexOf('  const moveProject =');
  const end = source.indexOf('  const draw =', start);
  const context = vm.createContext({ arr, list, markDirty() { changes++; }, draw() { draws++; } });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.move = moveProject;', context);
  context.move(0, 1);
  assert.deepEqual(arr.map(p => p.id), ['b', 'a', 'c']);
  assert.deepEqual(arr[1].blocks, ['keep']);
  assert.equal(focused, 1);
  context.move(1, 0);
  assert.deepEqual(arr.map(p => p.id), ['a', 'b', 'c']);
  context.move(0, -1); context.move(2, 3); context.move(1, 1);
  assert.equal(changes, 2); assert.equal(draws, 2);
}
