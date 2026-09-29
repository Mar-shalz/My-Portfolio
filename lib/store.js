// Content store: one JSON document plus an uploads folder, both under DATA_DIR.
// Every save is validated, written atomically, and the previous version is
// kept in backups/ so any change can be rolled back from the portal.
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

export function createStore({ dataDir, bundledDir }) {
  const file = path.join(dataDir, 'content.json');
  const uploadsDir = path.join(dataDir, 'uploads');
  const backupsDir = path.join(dataDir, 'backups');

  seed();
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

  function read() {
    if (!cache) cache = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    return cache;
  }

  function writeAtomic(target, data) {
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, target);
  }

  function backupCurrent() {
    const current = read();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeAtomic(path.join(backupsDir, `content-${stamp}-rev${current._rev || 0}.json`), current);
    const old = listBackups().slice(KEEP_BACKUPS);
    for (const b of old) fs.rmSync(path.join(backupsDir, b.name), { force: true });
  }

  function save(next, expectedRev) {
    const current = read();
    if (expectedRev != null && Number(expectedRev) !== Number(current._rev || 0)) {
      const err = new Error('The content was changed somewhere else since you opened it. Reload to get the latest version.');
      err.status = 409;
      throw err;
    }
    const doc = normalize(structuredClone(next));
    const problems = validate(doc);
    if (problems.length) {
      const err = new Error(problems.join(' '));
      err.status = 422;
      throw err;
    }
    backupCurrent();
    doc._rev = (current._rev || 0) + 1;
    doc.updatedAt = new Date().toISOString();
    writeAtomic(file, doc);
    cache = doc;
    return doc;
  }

  function listBackups() {
    return fs
      .readdirSync(backupsDir)
      .filter((n) => /^content-.*\.json$/.test(n))
      .map((name) => {
        const st = fs.statSync(path.join(backupsDir, name));
        const rev = Number((name.match(/-rev(\d+)\.json$/) || [])[1] || 0);
        return { name, rev, savedAt: st.mtime.toISOString(), size: st.size };
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  function restore(name) {
    if (!/^content-[\w-]+\.json$/.test(name)) throw Object.assign(new Error('Unknown backup.'), { status: 404 });
    const p = path.join(backupsDir, name);
    if (!fs.existsSync(p)) throw Object.assign(new Error('Unknown backup.'), { status: 404 });
    return save(JSON.parse(fs.readFileSync(p, 'utf8')), read()._rev);
  }

  function uploadPath(name) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) return null;
    const p = path.join(uploadsDir, name);
    return path.dirname(p) === uploadsDir ? p : null;
  }

  function listMedia() {
    const json = JSON.stringify(read());
    return fs
      .readdirSync(uploadsDir)
      .filter((n) => MEDIA_TYPES[path.extname(n).toLowerCase()])
      .map((name) => {
        const p = path.join(uploadsDir, name);
        const st = fs.statSync(p);
        const kind = MEDIA_TYPES[path.extname(name).toLowerCase()];
        const url = `/uploads/${name}`;
        return {
          name, url, kind,
          size: st.size,
          modified: st.mtime.toISOString(),
          dims: kind === 'image' ? imageSize(p) : null,
          used: json.split(`"${url}"`).length - 1,
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  function deleteMedia(name) {
    const p = uploadPath(name);
    if (!p || !fs.existsSync(p)) throw Object.assign(new Error('File not found.'), { status: 404 });
    fs.rmSync(p);
  }

  // Resolve a public /uploads/... URL to pixel dimensions for the renderer.
  function sizeOf(url) {
    const m = /^\/uploads\/([^?#]+)$/.exec(url || '');
    const p = m && uploadPath(decodeURIComponent(m[1]));
    return p ? imageSize(p) : null;
  }

  return { read, save, listBackups, restore, listMedia, deleteMedia, uploadPath, sizeOf, uploadsDir, dataDir };
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
