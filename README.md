# Victor Ajibodu — Portfolio + CMS

A story-driven product design portfolio with its own content portal.

- **Site** — server-rendered home, case studies, and About pages with warm paper,
  deep teal and readable accent colours. An interactive showcase features Mobile Banking,
  Internet Banking, and E-Token, followed by case studies, experience,
  an expandable method, ongoing projects, and contact details. Light/dark themes, keyboard-accessible mobile navigation,
  reading progress, pointer-responsive artwork, magnetic buttons, image zoom,
  and native reveal animations enhance the experience.
  Content remains readable without JavaScript or with reduced motion enabled.
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

- Wrap words in `*asterisks*` to emphasize them in the headline accent style.
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
public/assets/       Site CSS and interaction JS
admin/               The portal (HTML, CSS, JS — no build step)
scripts/export.js    Static export to dist/
api/index.js         Vercel entry point (wraps server.js)
lib/github.js        Saves content to GitHub when hosted on Vercel
data/                Content, uploads and backups
legacy/              The previous single-file portfolio, kept for reference
```

## Editorial presentation

`public/assets/editorial.css` supplies the current visual treatment over the shared
case-study styles. `site.js` uses browser-native interactions without loading GSAP
or Lenis. Only published projects appear on the public site; drafts remain available
in the editor. The testimonial section shows published quotes and an optional
invitation to share feedback. Sample quotes remain unpublished. The legacy manifesto and marquee fields remain stored for future use but
are not displayed on this homepage.

The 41K+ figure means total registered accounts (Data Analytics Team, November
2026), across KYC and activation stages. The 250+ figure means employee testers
of the implemented app. Unverified percentage improvements have been removed.
E-Token and Internet Banking use labeled explanatory diagrams until approved
product screens are supplied. Project covers replace diagrams when uploaded.
Both are firsts for Fast Credit. E-Token remains in TestFlight QA/internal testing;
Internet Banking remains in development. Neither is described as publicly launched.

The homepage follows a continuous story with a chapter index, readable narrative,
inspectable source images and restrained motion. Lufga is served locally. Both
light and dark themes use contrast-adjusted accent text, visible focus states,
and reduced-motion support. The portrait slot is restored; upload a real photo
under CMS → About → Portrait photo.

CMS → Home page controls section headlines, introduction, metrics/source note,
and other-products headings. CMS → Projects controls chapter title, challenge,
contribution, status narrative, next-chapter transition, featured order and artwork.
CMS → Method controls the process section. Archived manifesto, marquee, services
and card-metric fields are explicitly labelled as unused in the current layout.
Uploaded covers replace the labelled diagrams. Existing content and drafts remain
preserved; new case studies start unpublished, with no assumed delivery status.

Claude and ChatGPT skills appear in the hero, About narrative, capabilities and
toolkit. Chopbaze Website has its own live case study with a captured website
preview, design and AI-assisted coding ownership, and a live-site link. The
separate marketplace product remains in testing.

CMS → About controls the portrait motion, personal-section background and
principle statement. CMS → Testimonials controls the section and invitation
visibility, wording, and individual quote publication. CMS → Projects contains
the Chopbaze website alongside the existing studies. All public copy uses the
same content document as the CMS.

Featured case-study titles are plain headings. The coloured image panels and
“Read case study” labels inside them are the entry points; the separate buttons are gone. Their labels remain editable in CMS → Projects, with a default under Home page.
The UI/UX title is included alongside Product Design, and case-study status
labels use a quiet colour separate from the live-product buttons.

Two or more published testimonials become an automatic carousel. CMS →
Testimonials controls automatic rotation. Hover, keyboard focus, manual
navigation, hidden tabs and reduced-motion preferences stop rotation; visitors
can use previous/next or pause/resume. Sample quotes stay unpublished.

CMS → Site settings → Résumé accepts an uploaded PDF or a public Google Drive
file/folder link. It opens in a native modal with an Open original fallback.
A direct Drive file link previews the document; a folder link shows the shared
folder's public contents. The owner intentionally keeps a stable folder link so future CV uploads and
replacements appear without editing the portfolio link. The folder is currently empty.

The rounded arrow cursor follows the supplied reference without click rays. It
uses a native cursor asset on fine-pointer devices; text fields keep their text
cursor. The glass navbar keeps the résumé overlay accessible on desktop and
mobile; the hero has no résumé link. Chapter bridge links have distinct default
and hover/focus backgrounds in both themes.

### Save regression checks

Run `npm test` to check concurrent local saves, stale drafts, backups/restores,
failed writes, edits made while publishing, slug changes, retries and the existing
UI interactions. These checks use temporary files or in-memory responses and do
not write to the portfolio content.

Local saving checks the disk revision and writes without yielding, so a stale
publish is rejected instead of replacing newer content. The editor keeps edits
made during a request marked “Unpublished changes” and uses the returned revision
for the next publish. The local file store supports one Node server process;
multiple writer processes require shared locking. GitHub storage retains its
existing SHA-based conflict handling.
