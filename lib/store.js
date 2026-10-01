// Content store: one JSON document plus an uploads folder.
// Local mode keeps them under DATA_DIR with automatic backups.
// GitHub mode commits them to the repo, so git history is the backup and the
// host (e.g. Vercel) redeploys with the new content.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { slugify } from './text.js';
import { imageSize } from './imagesize.js';

const KEEP_BACKUPS = 50;
const KINDS = ['case-study', 'card'];

export const MEDIA_TYPES = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image', '.gif': 'image', '.avif': 'image',
  '.mp4': 'video', '.webm': 'video',
  '.pdf': 'document',
};

export function createStore({ dataDir, bundledDir, github = null, readOnly = false }) {
  const file = path.join(dataDir, 'content.json');
  const uploadsDir = path.join(dataDir, 'uploads');
  const backupsDir = path.join(dataDir, 'backups');

  if (!github && !readOnly) seed();
  let cache = null;

  // First boot on an empty volume: copy the bundled content and images in.
  function seed() {
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(backupsDir, { recursive: true });
    if (fs.existsSync(file)) return;
    const src = path.join(bundledDir, 'content.json');
    if (!fs.existsSync(src)) throw new Error(`No content found at ${src}`);
    fs.copyFileSync(src, file);
    const srcUploads = path.join(bundledDir, 'uploads');
    if (fs.existsSync(srcUploads) && path.resolve(srcUploads) !== path.resolve(uploadsDir)) {
      for (const name of fs.readdirSync(srcUploads)) {
        fs.copyFileSync(path.join(srcUploads, name), path.join(uploadsDir, name));
      }
    }
  }

  // What the public site renders. On GitHub mode this is the deployed copy
  // (plus anything this instance just published).
  function read() {
    if (!cache) cache = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    return cache;
  }

  const conflict = () => Object.assign(new Error('The content was changed somewhere else since you opened it. Reload to get the latest version.'), { status: 409 });

  function prepare(next, current, expectedRev) {
    if (expectedRev != null && Number(expectedRev) !== Number(current._rev || 0)) throw conflict();
    const doc = normalize(structuredClone(next));
    const problems = validate(doc);
    if (problems.length) throw Object.assign(new Error(problems.join(' ')), { status: 422 });
    doc._rev = (current._rev || 0) + 1;
    doc.updatedAt = new Date().toISOString();
    return doc;
  }

  function uploadPath(name) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) return null;
    const p = path.join(uploadsDir, name);
    return path.dirname(p) === uploadsDir ? p : null;
  }

  const kindOf = (name) => MEDIA_TYPES[path.extname(name).toLowerCase()];
  const notFound = () => Object.assign(new Error('File not found.'), { status: 404 });

  // Resolve a public /uploads/... URL to pixel dimensions for the renderer.
  function sizeOf(url) {
    const m = /^\/uploads\/([^?#]+)$/.exec(url || '');
    const p = m && uploadPath(decodeURIComponent(m[1]));
    return p ? imageSize(p) : null;
  }

  const common = { read, uploadPath, sizeOf, uploadsDir, dataDir, mode: github ? 'github' : 'local' };

  /* ---------------- read-only host without GitHub settings ---------------- */
  if (!github && readOnly) {
    const locked = async () => {
      throw Object.assign(new Error('Saving is off: add GITHUB_TOKEN and GITHUB_REPO in your hosting settings, then redeploy.'), { status: 503 });
    };
    return {
      ...common,
      mode: 'read-only',
      latest: async () => read(),
      save: locked, restore: locked, saveUpload: locked, deleteMedia: locked,
      listBackups: async () => [],
      async listMedia() {
        return fs.readdirSync(uploadsDir).filter(kindOf).map((name) => ({ name, url: `/uploads/${name}`, kind: kindOf(name), size: fs.statSync(path.join(uploadsDir, name)).size, modified: '', dims: null, used: 0 }));
      },
      fetchUpload: async () => null,
    };
  }

  /* ---------------- local disk ---------------- */
  if (!github) {
    const writeAtomic = (target, data) => {
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n');
      fs.renameSync(tmp, target);
    };
    const listBackups = async () =>
      fs.readdirSync(backupsDir)
        .filter((n) => /^content-.*\.json$/.test(n))
        .map((name) => {
          const st = fs.statSync(path.join(backupsDir, name));
          const rev = Number((name.match(/-rev(\d+)\.json$/) || [])[1] || 0);
          return { name, rev, label: `Version ${rev}`, savedAt: st.mtime.toISOString(), size: st.size };
        })
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));

    async function save(next, expectedRev) {
      const current = read();
      const doc = prepare(next, current, expectedRev);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      writeAtomic(path.join(backupsDir, `content-${stamp}-rev${current._rev || 0}.json`), current);
      for (const b of (await listBackups()).slice(KEEP_BACKUPS)) fs.rmSync(path.join(backupsDir, b.name), { force: true });
      writeAtomic(file, doc);
      cache = doc;
      return doc;
    }

    return {
      ...common,
      latest: async () => read(),
      save,
      listBackups,
      async restore(name) {
        const p = /^content-[\w-]+\.json$/.test(name) && path.join(backupsDir, name);
        if (!p || !fs.existsSync(p)) throw Object.assign(new Error('Unknown backup.'), { status: 404 });
        return save(JSON.parse(fs.readFileSync(p, 'utf8')), read()._rev);
      },
      async listMedia() {
        const json = JSON.stringify(read());
        return fs.readdirSync(uploadsDir)
          .filter(kindOf)
          .map((name) => {
            const p = path.join(uploadsDir, name);
            const st = fs.statSync(p);
            const kind = kindOf(name);
            const url = `/uploads/${name}`;
            return { name, url, kind, size: st.size, modified: st.mtime.toISOString(), dims: kind === 'image' ? imageSize(p) : null, used: json.split(`"${url}"`).length - 1 };
          })
          .sort((a, b) => b.modified.localeCompare(a.modified));
      },
      async saveUpload(name, buf) {
        const p = uploadPath(name);
        if (!p) throw Object.assign(new Error('Bad file name.'), { status: 400 });
        writeAtomic(p, buf);
      },
      async deleteMedia(name) {
        const p = uploadPath(name);
        if (!p || !fs.existsSync(p)) throw notFound();
        fs.rmSync(p);
      },
      fetchUpload: async () => null,
    };
  }

  /* ---------------- GitHub repo ---------------- */
  const CONTENT = 'data/content.json';
  const UPLOADS = 'data/uploads';

  async function latestWithSha() {
    const f = await github.get(CONTENT);
    if (!f) throw Object.assign(new Error(`${CONTENT} is missing from the GitHub repo.`), { status: 502 });
    return { doc: normalize(JSON.parse(f.buf.toString('utf8'))), sha: f.sha };
  }

  async function save(next, expectedRev) {
    const { doc: current, sha } = await latestWithSha();
    const doc = prepare(next, current, expectedRev);
    await github.put(CONTENT, JSON.stringify(doc, null, 2) + '\n', `Update content from portal (version ${doc._rev})`, sha);
    cache = doc;
    return doc;
  }

  return {
    ...common,
    latest: async () => (await latestWithSha()).doc,
    save,
    async listBackups() {
      const commits = await github.commits(CONTENT);
      // The newest commit is the live version; everything after it can be restored.
      return commits.slice(1).map((c) => ({
        name: c.sha,
        rev: 0,
        label: (c.commit?.message || 'Earlier version').split('\n')[0],
        savedAt: c.commit?.committer?.date || c.commit?.author?.date,
        size: 0,
      }));
    },
    async restore(sha) {
      if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw Object.assign(new Error('Unknown version.'), { status: 404 });
      const old = await github.get(CONTENT, sha);
      if (!old) throw Object.assign(new Error('Unknown version.'), { status: 404 });
      const { doc: current } = await latestWithSha();
      return save(JSON.parse(old.buf.toString('utf8')), current._rev);
    },
    async listMedia() {
      const json = JSON.stringify((await latestWithSha()).doc);
      return (await github.list(UPLOADS))
        .filter((f) => kindOf(f.name))
        .map((f) => {
          const kind = kindOf(f.name);
          const url = `/uploads/${f.name}`;
          const local = uploadPath(f.name);
          return { name: f.name, url, kind, size: f.size, modified: '', dims: kind === 'image' && local ? imageSize(local) : null, used: json.split(`"${url}"`).length - 1 };
        });
    },
    async saveUpload(name, buf) {
      if (!uploadPath(name)) throw Object.assign(new Error('Bad file name.'), { status: 400 });
      await github.put(`${UPLOADS}/${name}`, buf, `Upload ${name} from portal`);
    },
    async deleteMedia(name) {
      if (!uploadPath(name)) throw notFound();
      const f = await github.get(`${UPLOADS}/${name}`);
      if (!f) throw notFound();
      await github.del(`${UPLOADS}/${name}`, f.sha, `Delete ${name} from portal`);
    },
    // New uploads exist on GitHub before the next deploy lands; serve them from there meanwhile.
    async fetchUpload(name) {
      if (!uploadPath(name)) return null;
      return (await github.get(`${UPLOADS}/${name}`))?.buf || null;
    },
  };
}

// Fill in anything missing so the renderer never has to guess.
export function normalize(doc) {
  doc = doc && typeof doc === 'object' ? doc : {};
  const obj = (k) => (doc[k] = doc[k] && typeof doc[k] === 'object' && !Array.isArray(doc[k]) ? doc[k] : {});
  const arr = (o, k) => (o[k] = Array.isArray(o[k]) ? o[k] : []);

  const site = obj('site');
  site.availability = site.availability || { open: true, label: '' };
  arr(site, 'socials');
  const hero = obj('hero');
  arr(hero, 'lines');
  arr(hero, 'metrics');
  obj('manifesto');
  if (!Array.isArray(doc.marquee)) doc.marquee = [];
  obj('work');
  arr(obj('process'), 'steps');
  arr(obj('services'), 'items');
  arr(obj('testimonials'), 'items');
  const about = obj('about');
  for (const k of ['stats', 'now', 'experience', 'capabilities', 'domains']) arr(about, k);
  obj('contact');

  // Early portal builds wrote Site settings to the document root; fold them back into site.
  for (const k of ['availability', 'socials', 'resumeUrl']) {
    if (k in doc && k !== 'site') {
      const v = doc[k];
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
      if (!empty) site[k] = v;
      delete doc[k];
    }
  }

  const seen = new Set();
  doc.projects = (Array.isArray(doc.projects) ? doc.projects : []).map((p) => {
    p = p && typeof p === 'object' ? p : {};
    p.id = p.id || crypto.randomUUID();
    p.kind = KINDS.includes(p.kind) ? p.kind : 'card';
    p.published = p.published !== false;
    let slug = slugify(p.slug || p.title) || `project-${seen.size + 1}`;
    while (seen.has(slug)) slug = `${slug}-2`;
    seen.add(slug);
    p.slug = slug;
    for (const k of ['tags', 'stats', 'meta', 'links', 'blocks']) arr(p, k);
    p.glance = p.glance && typeof p.glance === 'object' ? p.glance : {};
    p.blocks = p.blocks.filter((b) => b && typeof b === 'object' && b.type);
    return p;
  });
  return doc;
}

function validate(doc) {
  const out = [];
  if (!String(doc.site.name || '').trim()) out.push('Site name is required.');
  doc.projects.forEach((p, i) => {
    if (!String(p.title || '').trim()) out.push(`Project #${i + 1} needs a title.`);
  });
  return out;
}
