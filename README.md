# Victor Ajibodu — Portfolio + CMS

A story-driven product design portfolio with its own content portal.

- **Site** — server-rendered pages (home, case studies, about) with a motion layer:
  curtain page transitions, split-line headlines, a scroll-lit prologue, stacked
  project cards, a pinned horizontal "method" section, live counters, a magnetic
  cursor and smooth scrolling (GSAP + ScrollTrigger + SplitText + Lenis).
  Everything still reads correctly with JavaScript off or with reduced motion on.
- **CMS portal** at `/admin` — edit every word, image and project; add, reorder,
  duplicate or unpublish projects; build case studies from story blocks; upload
  media; preview drafts before publishing; roll back to any of the last 50 versions.

## Run it

```bash
npm install
npm run dev
```

- Site: http://localhost:3000
- Portal: http://localhost:3000/admin

On first run a `.env` file is created with a random `ADMIN_PASSWORD`. Open it to
sign in, and change the value any time (restart the server afterwards).

## How content works

| What | Where |
| --- | --- |
| All text, projects and settings | `data/content.json` |
| Uploaded images, videos, PDFs | `data/uploads/` |
| Automatic backups (last 50 publishes) | `data/backups/` |

The portal writes these files for you. Editing `content.json` by hand also works.

### Writing tips inside the portal

- Wrap words in `*asterisks*` to render them in the orange serif italic accent.
- `**double asterisks**` for bold, `[text](https://…)` for links.
- Leave a blank line between paragraphs; start lines with `- ` for a list.
- In a case study, any block with a **chapter label** appears in the side navigation.

## Deploy

### Option A — Node host with a disk (edit from anywhere)

Works on Railway, Render (with a disk), Fly.io or any VPS.

1. Set environment variables:
   - `NODE_ENV=production`
   - `ADMIN_PASSWORD=<a long random password>`
   - `SESSION_SECRET=<64 random hex characters>`
   - `DATA_DIR=/data` (a mounted persistent volume)
2. Start command: `npm start`

On first boot the bundled `data/` folder is copied into `DATA_DIR`. After that,
everything you publish from `/admin` is saved on the volume.

A `Dockerfile` is included for hosts that build containers.

### Option B — Static hosting (free)

Edit locally in the portal, then:

```bash
npm run export
```

Upload the `dist/` folder to Netlify, Vercel, Cloudflare Pages or GitHub Pages.
The portal itself is not included in the export.

## Project structure

```
server.js            Express server: site, portal, API
lib/render.js        HTML for every page
lib/store.js         Content store, validation, backups, media
lib/auth.js          Portal sign-in (password + signed cookie)
lib/text.js          Escaping and the small markdown subset
public/assets/       Site CSS and motion JS
admin/               The portal (HTML, CSS, JS — no build step)
scripts/export.js    Static export to dist/
data/                Content, uploads and backups
legacy/              The previous single-file portfolio, kept for reference
```
