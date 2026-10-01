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

## Deploy for free (Vercel + GitHub)

The site runs on Vercel's free Hobby plan. When you press **Publish** in the
portal, it saves your content and uploads into this GitHub repo, and Vercel
redeploys the site automatically (about a minute). Git history doubles as the
backup, so **History** in the portal can roll back any publish.

1. Push this project to a GitHub repository (private is fine).
2. Create a GitHub token the portal can save with:
   GitHub, then Settings, Developer settings, Personal access tokens,
   Fine-grained tokens, Generate new token. Repository access: only this repo.
   Permissions: **Contents: Read and write**. Copy the token.
3. Go to vercel.com, sign up with GitHub (free), click **Add New, Project**,
   and import the repository. Leave build settings as they are.
4. Before deploying, add these Environment Variables:
   - `ADMIN_PASSWORD` a long password for the portal
   - `SESSION_SECRET` 64 random hex characters
     (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `GITHUB_TOKEN` the token from step 2
   - `GITHUB_REPO` `your-username/your-repo`
5. Click **Deploy**. Your site is at `https://<project>.vercel.app` and the
   portal at `https://<project>.vercel.app/admin`.

Limits on the free plan: uploads up to 4 MB each (compress images and
videos first), and the site must be personal, non-commercial use.

## Other hosting options

- **Node host with a disk** (Railway, Render, Fly.io, a VPS): set
  `NODE_ENV=production`, `ADMIN_PASSWORD`, `SESSION_SECRET` and
  `DATA_DIR=/data` on a persistent volume, then run `npm start`. A
  `Dockerfile` and `railway.json` are included. These hosts are not free.
- **Static only**: run `npm run export` and upload `dist/` anywhere. The
  portal is not included; edit locally first.

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
api/index.js         Vercel entry point (wraps server.js)
lib/github.js        Saves content to GitHub when hosted on Vercel
data/                Content, uploads and backups
legacy/              The previous single-file portfolio, kept for reference
```
