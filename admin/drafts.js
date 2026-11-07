// Drafts stay in this browser. Each editor owns its writes, including duplicated tabs.
export function createDraftStore({ storage = () => localStorage, session = () => sessionStorage, id = () => crypto.randomUUID() } = {}) {
  const prefix = 'portfolio-cms:draft:v1:';
  const tabKey = 'portfolio-cms:active-draft';
  const owner = id();
  let key;
  try { key = session().getItem(tabKey); } catch {}
  if (!key?.startsWith(prefix)) key = prefix + id();

  function read(name) {
    const raw = storage().getItem(name);
    if (!raw) return null;
    try {
      const draft = JSON.parse(raw);
      if (draft.version !== 1 || !Number.isSafeInteger(draft.rev) || draft.rev < 0 ||
          !draft.content?.site || !Array.isArray(draft.content.projects) ||
          typeof draft.savedAt !== 'string' || !Number.isFinite(Date.parse(draft.savedAt))) return null;
      return { ...draft, key: name, raw };
    } catch { return null; }
  }

  return {
    current(mode) { const draft = read(key); return draft?.mode === mode ? draft : null; },
    list(mode) {
      const result = [];
      const store = storage();
      for (let i = 0; i < store.length; i++) {
        const name = store.key(i);
        if (!name?.startsWith(prefix)) continue;
        const draft = read(name);
        if (draft?.mode === mode) result.push(draft);
      }
      return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    save(content, rev, mode) {
      const existing = read(key);
      // A duplicated/reopened tab must not replace another editor's draft.
      if (existing && existing.owner !== owner) key = prefix + id();
      const draft = { version: 1, owner, mode, rev, savedAt: new Date().toISOString(), content };
      storage().setItem(key, JSON.stringify(draft));
      try { session().setItem(tabKey, key); } catch {}
      return draft.savedAt;
    },
    restore(draft) {
      if (storage().getItem(draft.key) !== draft.raw) throw new Error('This draft changed in another tab. Reopen Saved drafts to recover the latest copy.');
      const { key: savedKey, raw, ...saved } = draft;
      storage().setItem(savedKey, JSON.stringify({ ...saved, owner }));
      key = savedKey;
      try { session().setItem(tabKey, key); } catch {}
    },
    clear() {
      const draft = read(key);
      if (draft?.owner === owner) storage().removeItem(key);
      key = prefix + id();
      try { session().removeItem(tabKey); } catch {}
    },
    discard(draft) {
      // Do not discard a saved draft that changed after the chooser opened.
      if (storage().getItem(draft.key) !== draft.raw) throw new Error('This draft changed in another tab. Reopen Saved drafts before discarding it.');
      storage().removeItem(draft.key);
    },
  };
}
