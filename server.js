// Portfolio server: renders the public site from data/content.json and hosts
// the CMS portal at /admin with a small JSON API behind a password.
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore, normalize, MEDIA_TYPES } from './lib/store.js';
import { createAuth } from './lib/auth.js';
import { createRenderer } from './lib/render.js';
import { slugify } from './lib/text.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

// First local run: create .env with a random admin password so the portal is never open.
if (!process.env.ADMIN_PASSWORD) {
  if (isProd) {
    console.error('ADMIN_PASSWORD must be set in production. Refusing to start.');
    process.exit(1);
  }
  const password = crypto.randomBytes(12).toString('base64url');
  const secret = crypto.randomBytes(32).toString('hex');
  fs.appendFileSync(envFile, `ADMIN_PASSWORD=${password}\nSESSION_SECRET=${secret}\n`);
  process.env.ADMIN_PASSWORD = password;
  process.env.SESSION_SECRET = secret;
  console.log('Created .env with a new admin password. Open .env to see it, and change it any time.');
}

const store = createStore({
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  bundledDir: path.join(ROOT, 'data'),
});
const auth = createAuth({
  password: process.env.ADMIN_PASSWORD,
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  secure: isProd,
});
const assetVersion = Date.now().toString(36);
const renderer = createRenderer({ sizeOf: store.sizeOf, assetVersion });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

// ---------- static ----------
const cache = (age) => (isProd ? { maxAge: age } : { etag: false, lastModified: false, setHeaders: (res) => res.set('Cache-Control', 'no-store') });
app.use('/assets', express.static(path.join(ROOT, 'public/assets'), cache('7d')));
app.use('/uploads', express.static(store.uploadsDir, cache('30d')));
const VENDOR = {
  'gsap.min.js': 'node_modules/gsap/dist/gsap.min.js',
  'ScrollTrigger.min.js': 'node_modules/gsap/dist/ScrollTrigger.min.js',
  'SplitText.min.js': 'node_modules/gsap/dist/SplitText.min.js',
  'lenis.min.js': 'node_modules/lenis/dist/lenis.min.js',
};
app.get('/vendor/:file', (req, res, next) => {
  const rel = VENDOR[req.params.file];
  if (!rel) return next();
  res.set('Cache-Control', isProd ? 'public, max-age=604800' : 'no-cache');
  res.sendFile(path.join(ROOT, rel));
});
app.use('/admin', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, express.static(path.join(ROOT, 'admin')));

// ---------- API ----------
const api = express.Router();
api.use(express.json({ limit: '5mb' }));

// Browsers can't add custom headers to cross-site form posts, so this blocks CSRF.
api.use((req, res, next) => {
  if (req.method !== 'GET' && req.get('X-CMS') !== '1') return res.status(403).json({ error: 'Missing request header.' });
  next();
});
const requireAuth = (req, res, next) => (auth.isAuthed(req) ? next() : res.status(401).json({ error: 'Please sign in again.' }));

api.get('/session', (req, res) => res.json({ authed: auth.isAuthed(req) }));

api.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (auth.isLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!auth.checkPassword(req.body?.password || '')) {
    auth.recordFailure(ip);
    return res.status(401).json({ error: 'That password is not right.' });
  }
  auth.login(res);
  res.json({ ok: true });
});

api.post('/logout', (req, res) => {
  auth.logout(res);
  res.json({ ok: true });
});

api.get('/content', requireAuth, (req, res) => res.json(store.read()));

api.put('/content', requireAuth, (req, res, next) => {
  try {
    const saved = store.save(req.body?.content, req.body?.rev);
    res.json({ rev: saved._rev, updatedAt: saved.updatedAt, content: saved });
  } catch (e) {
    next(e);
  }
});

// Drafts are rendered from memory so you can preview without publishing.
const previews = new Map();
api.post('/preview', requireAuth, (req, res) => {
  const token = crypto.randomBytes(12).toString('base64url');
  const now = Date.now();
  for (const [k, v] of previews) if (v.exp < now) previews.delete(k);
  while (previews.size >= 30) previews.delete(previews.keys().next().value);
  previews.set(token, { content: req.body?.content, exp: now + 30 * 60 * 1000 });
  res.json({ token });
});

api.get('/media', requireAuth, (req, res) => res.json(store.listMedia()));

const upload = multer({
  storage: multer.diskStorage({
    destination: store.uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = slugify(path.basename(file.originalname, ext)) || 'file';
      cb(null, `${base}-${crypto.randomBytes(3).toString('hex')}${ext === '.jpeg' ? '.jpg' : ext}`);
    },
  }),
  limits: { fileSize: 40 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const kind = MEDIA_TYPES[ext];
    const okMime = kind === 'document' ? file.mimetype === 'application/pdf' : file.mimetype.startsWith(`${kind}/`);
    cb(kind && okMime ? null : Object.assign(new Error(`${file.originalname}: use JPG, PNG, WebP, GIF, AVIF, MP4, WebM or PDF.`), { status: 415 }), Boolean(kind && okMime));
  },
});
api.post('/media', requireAuth, upload.array('files', 20), (req, res) => {
  res.json({ files: (req.files || []).map((f) => ({ name: f.filename, url: `/uploads/${f.filename}` })) });
});

api.delete('/media/:name', requireAuth, (req, res, next) => {
  try {
    store.deleteMedia(req.params.name);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

api.get('/backups', requireAuth, (req, res) => res.json(store.listBackups()));
api.post('/backups/:name/restore', requireAuth, (req, res, next) => {
  try {
    const saved = store.restore(req.params.name);
    res.json({ rev: saved._rev, updatedAt: saved.updatedAt, content: saved });
  } catch (e) {
    next(e);
  }
});

api.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : err.message });
});
app.use('/api', api);

// ---------- site ----------
const ctxFor = (content, base = '', preview = false) => ({ c: content, base, preview });
const html = (res, body, status = 200) => res.status(status).type('html').set('Cache-Control', 'no-cache').send(body);

function sitePages(router, getCtx) {
  router.get('/', (req, res) => html(res, renderer.home(getCtx(req))));
  router.get('/about', (req, res) => html(res, renderer.about(getCtx(req))));
  router.get('/work/:slug', (req, res) => {
    const ctx = getCtx(req);
    const p = ctx.c.projects.find((x) => x.slug === req.params.slug && x.kind === 'case-study' && (x.published || ctx.preview));
    if (!p) return html(res, renderer.notFound(ctx), 404);
    html(res, renderer.caseStudy(ctx, p));
  });
}

const site = express.Router();
sitePages(site, () => ctxFor(store.read()));
app.use('/', site);

// /preview/<token>/... renders an unsaved draft for the signed-in owner only.
const preview = express.Router({ mergeParams: true });
preview.use((req, res, next) => {
  const entry = previews.get(req.params.token);
  if (!auth.isAuthed(req) || !entry || entry.exp < Date.now()) {
    return res.status(404).type('text').send('This preview has expired. Open it again from the portal.');
  }
  res.set('X-Robots-Tag', 'noindex');
  req.previewContent = entry.content;
  next();
});
sitePages(preview, (req) => ctxFor(normalize(structuredClone(req.previewContent)), `/preview/${req.params.token}`, true));
app.use('/preview/:token', preview);

app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /admin\nDisallow: /preview\n'));
app.get('/sitemap.xml', (req, res) => {
  const c = store.read();
  const base = String(c.site.siteUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const paths = ['/', '/about', ...c.projects.filter((p) => p.published && p.kind === 'case-study').map((p) => `/work/${p.slug}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${base}${p}</loc></url>`).join('')}</urlset>`);
});

app.use((req, res) => html(res, renderer.notFound(ctxFor(store.read())), 404));

app.listen(PORT, () => {
  console.log(`Portfolio running at http://localhost:${PORT}`);
  console.log(`CMS portal at       http://localhost:${PORT}/admin`);
});
