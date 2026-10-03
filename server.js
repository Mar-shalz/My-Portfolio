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
import { createGitHub } from './lib/github.js';
import { createRenderer } from './lib/render.js';
import { slugify } from './lib/text.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const onVercel = Boolean(process.env.VERCEL);

// First local run: create .env with a random admin password so the portal is never open.
// In production without a password the public site still works; the portal stays locked.
if (!process.env.ADMIN_PASSWORD && isProd) {
  console.error('ADMIN_PASSWORD is not set. The site is up, but the /admin portal is disabled until you set it.');
} else if (!process.env.ADMIN_PASSWORD) {
  const password = crypto.randomBytes(12).toString('base64url');
  const secret = crypto.randomBytes(32).toString('hex');
  fs.appendFileSync(envFile, `ADMIN_PASSWORD=${password}\nSESSION_SECRET=${secret}\n`);
  process.env.ADMIN_PASSWORD = password;
  process.env.SESSION_SECRET = secret;
  console.log('Created .env with a new admin password. Open .env to see it, and change it any time.');
}

// With GITHUB_TOKEN + GITHUB_REPO set, the portal saves to the GitHub repo
// (needed on hosts like Vercel whose disk is read-only).
const github = process.env.GITHUB_TOKEN && process.env.GITHUB_REPO
  ? createGitHub({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPO, branch: process.env.GITHUB_BRANCH || 'main', api: process.env.GITHUB_API_URL })
  : null;
const store = createStore({
  dataDir: path.resolve(ROOT, github ? 'data' : process.env.DATA_DIR || 'data'),
  bundledDir: path.join(ROOT, 'data'),
  github,
  readOnly: onVercel && !github,
});
const portalReady = Boolean(process.env.ADMIN_PASSWORD);
const auth = createAuth({
  password: process.env.ADMIN_PASSWORD || crypto.randomBytes(32).toString('hex'),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  secure: isProd,
});
const assetVersion = Date.now().toString(36);
const renderer = createRenderer({ sizeOf: store.sizeOf, assetVersion, analytics: onVercel });

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
// GitHub mode: a file uploaded a moment ago is not in this deploy yet. Serve it from the repo.
app.get('/uploads/:name', async (req, res, next) => {
  const buf = await store.fetchUpload(req.params.name).catch(() => null);
  if (!buf) return next();
  res.type(path.extname(req.params.name)).set('Cache-Control', 'public, max-age=300').send(buf);
});
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

api.get('/session', (req, res) => res.json({ authed: auth.isAuthed(req), mode: store.mode }));

api.post('/login', (req, res) => {
  if (!portalReady) return res.status(503).json({ error: 'The portal is not set up yet. Add ADMIN_PASSWORD in your hosting settings, then redeploy.' });
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

api.get('/content', requireAuth, async (req, res) => res.json(await store.latest()));

api.put('/content', requireAuth, async (req, res) => {
  const saved = await store.save(req.body?.content, req.body?.rev);
  res.json({ rev: saved._rev, updatedAt: saved.updatedAt, content: saved, mode: store.mode });
});

// Preview renders the unsaved draft straight away; nothing is stored.
api.post('/preview', requireAuth, (req, res) => {
  const ctx = ctxFor(normalize(structuredClone(req.body?.content || {})), '', true);
  const slug = /^\/work\/([^/?#]+)/.exec(req.body?.path || '')?.[1];
  let page;
  if (slug) {
    const p = ctx.c.projects.find((x) => x.slug === slug && x.kind === 'case-study');
    page = p ? renderer.caseStudy(ctx, p) : renderer.notFound(ctx);
  } else if (/^\/about/.test(req.body?.path || '')) page = renderer.about(ctx);
  else page = renderer.home(ctx);
  res.json({ html: page });
});

api.get('/media', requireAuth, async (req, res) => res.json(await store.listMedia()));

// Vercel functions accept request bodies up to 4.5 MB.
const MAX_UPLOAD = onVercel ? 4 * 1024 * 1024 : 40 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const kind = MEDIA_TYPES[ext];
    const okMime = kind === 'document' ? file.mimetype === 'application/pdf' : file.mimetype.startsWith(`${kind}/`);
    cb(kind && okMime ? null : Object.assign(new Error(`${file.originalname}: use JPG, PNG, WebP, GIF, AVIF, MP4, WebM or PDF.`), { status: 415 }), Boolean(kind && okMime));
  },
});
api.post('/media', requireAuth, upload.array('files', 20), async (req, res) => {
  const files = [];
  for (const f of req.files || []) {
    const ext = path.extname(f.originalname).toLowerCase();
    const base = slugify(path.basename(f.originalname, ext)) || 'file';
    const name = `${base}-${crypto.randomBytes(3).toString('hex')}${ext === '.jpeg' ? '.jpg' : ext}`;
    await store.saveUpload(name, f.buffer);
    files.push({ name, url: `/uploads/${name}` });
  }
  res.json({ files });
});

api.delete('/media/:name', requireAuth, async (req, res) => {
  await store.deleteMedia(req.params.name);
  res.json({ ok: true });
});

api.get('/backups', requireAuth, async (req, res) => res.json(await store.listBackups()));
api.post('/backups/:name/restore', requireAuth, async (req, res) => {
  const saved = await store.restore(req.params.name);
  res.json({ rev: saved._rev, updatedAt: saved.updatedAt, content: saved });
});

api.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (err.code === 'LIMIT_FILE_SIZE') err.message = `That file is over ${MAX_UPLOAD / 1048576} MB. Compress it and try again.`;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? `Something went wrong on the server: ${err.message}` : err.message });
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

app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /admin\n'));
app.get('/sitemap.xml', (req, res) => {
  const c = store.read();
  const base = String(c.site.siteUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const paths = ['/', '/about', ...c.projects.filter((p) => p.published && p.kind === 'case-study').map((p) => `/work/${p.slug}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${base}${p}</loc></url>`).join('')}</urlset>`);
});

app.use((req, res) => html(res, renderer.notFound(ctxFor(store.read())), 404));

export default app;

if (!onVercel) {
  app.listen(PORT, () => {
    console.log(`Portfolio running at http://localhost:${PORT}  (content: ${store.mode})`);
    console.log(`CMS portal at       http://localhost:${PORT}/admin`);
  });
}
