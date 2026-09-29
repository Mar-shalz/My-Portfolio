// Static export: renders every public page from the current content into dist/
// so the site can be hosted anywhere static (Netlify drop, GitHub Pages, S3...).
// The CMS portal needs the Node server; run it locally, publish, then export.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../lib/store.js';
import { createRenderer } from '../lib/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const OUT = path.join(ROOT, 'dist');
const store = createStore({ dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'), bundledDir: path.join(ROOT, 'data') });
const renderer = createRenderer({ sizeOf: store.sizeOf, assetVersion: Date.now().toString(36) });
const content = store.read();
const ctx = { c: content, base: '', preview: false };

fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, body) => {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const copyDir = (from, to) => fs.existsSync(from) && fs.cpSync(from, path.join(OUT, to), { recursive: true });

write('index.html', renderer.home(ctx));
write('about/index.html', renderer.about(ctx));
write('404.html', renderer.notFound(ctx));
const studies = content.projects.filter((p) => p.published && p.kind === 'case-study');
for (const p of studies) write(`work/${p.slug}/index.html`, renderer.caseStudy(ctx, p));

copyDir(path.join(ROOT, 'public/assets'), 'assets');
copyDir(store.uploadsDir, 'uploads');
const vendor = {
  'gsap.min.js': 'node_modules/gsap/dist/gsap.min.js',
  'ScrollTrigger.min.js': 'node_modules/gsap/dist/ScrollTrigger.min.js',
  'SplitText.min.js': 'node_modules/gsap/dist/SplitText.min.js',
  'lenis.min.js': 'node_modules/lenis/dist/lenis.min.js',
};
for (const [name, rel] of Object.entries(vendor)) write(`vendor/${name}`, fs.readFileSync(path.join(ROOT, rel)));

const base = String(content.site.siteUrl || '').replace(/\/+$/, '');
write('robots.txt', `User-agent: *\nAllow: /\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ''}`);
if (base) {
  const urls = ['/', '/about', ...studies.map((p) => `/work/${p.slug}`)];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>\n`);
}

console.log(`Exported ${3 + studies.length} pages to dist/`);
