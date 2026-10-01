// Portfolio CMS portal. A small schema-driven editor over one JSON document:
// every page below is described as a list of fields, and generic renderers turn
// those fields into inputs that write straight back into the draft.

/* ============================================================ helpers */

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const plain = (s = '') => String(s ?? '').replace(/\*+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
const slugify = (s = '') => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isVideo = (u = '') => /\.(mp4|webm)([?#]|$)/i.test(u);
const isPdf = (u = '') => /\.pdf([?#]|$)/i.test(u);
const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/* ============================================================ state & API */

const state = { content: null, rev: 0, dirty: false, saving: false, media: null, mode: 'local' };
const openItems = new WeakSet();

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: { 'X-CMS': '1' }, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (form) opts.body = form;
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new Error('Your session ended. Sign in again. Your unsaved edits are kept.');
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

function toast(msg, type = '') {
  const t = h(`div.toast${type ? `.is-${type}` : ''}`, {}, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3200);
}

function markDirty() {
  state.dirty = true;
  updateStatus();
}

function updateStatus() {
  const el = $('#status');
  el.className = `status${state.saving ? ' is-saving' : state.dirty ? ' is-dirty' : ''}`;
  el.textContent = state.saving ? 'Publishing…' : state.dirty ? 'Unpublished changes' : `Live · ${state.content?.updatedAt ? timeAgo(state.content.updatedAt) : ''}`;
  $('#saveBtn').disabled = state.saving || !state.dirty;
}

async function save() {
  if (state.saving || !state.dirty) return;
  state.saving = true;
  updateStatus();
  try {
    const r = await api('/content', { method: 'PUT', body: { content: state.content, rev: state.rev } });
    // Keep the local draft (so open panels stay open); only adopt what the server normalised.
    state.rev = r.rev;
    state.content._rev = r.rev;
    state.content.updatedAt = r.updatedAt;
    let changed = false;
    for (const p of state.content.projects) {
      const s = r.content.projects.find((x) => x.id === p.id);
      if (s && s.slug !== p.slug) { p.slug = s.slug; changed = true; }
    }
    state.dirty = false;
    toast(state.mode === 'github' ? 'Published. Your live site updates in about a minute.' : 'Published. Your site is updated.');
    if (changed) route(true);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    state.saving = false;
    updateStatus();
  }
}

async function preview(path = '/') {
  const win = window.open('', '_blank');
  try {
    const { html } = await api('/preview', { method: 'POST', body: { content: state.content, path } });
    if (!win) return toast('Allow pop-ups for this site to see previews.', 'error');
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (e) {
    win?.close();
    toast(e.message, 'error');
  }
}

async function loadMedia(force = false) {
  if (!state.media || force) state.media = await api('/media');
  return state.media;
}

async function uploadFiles(files) {
  const form = new FormData();
  [...files].forEach((f) => form.append('files', f));
  const r = await api('/media', { method: 'POST', form });
  state.media = null;
  toast(r.files.length === 1 ? 'Uploaded.' : `${r.files.length} files uploaded.`);
  return r.files;
}

/* ============================================================ modal */

function modal({ title, body, actions = [], wide = false, onClose }) {
  const root = $('#modalRoot');
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const bg = h('div.modal-bg', { onclick: (e) => { if (e.target === bg) close(); } },
    h(`div.modal${wide ? '.is-wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.modal-head', {}, h('h2', {}, title), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
      h('div.modal-body', {}, body),
      actions.length ? h('div.modal-foot', {}, actions.map((a) => h(`button.btn.${a.kind || 'btn-ghost'}`, { type: 'button', onclick: () => a.run(close) }, a.label))) : null,
    ));
  document.addEventListener('keydown', esc);
  root.append(bg);
  bg.querySelector('input,textarea,select,button.btn-primary,button.btn-accent')?.focus();
  return close;
}

const confirmBox = (title, text, label = 'Delete', kind = 'btn-danger') =>
  new Promise((resolve) => {
    modal({
      title,
      body: h('p', {}, text),
      actions: [
        { label: 'Cancel', run: (c) => { resolve(false); c(); } },
        { label, kind, run: (c) => { resolve(true); c(); } },
      ],
      onClose: () => resolve(false),
    });
  });

/* ============================================================ schemas */

const MD_HELP = h('span', {}, 'Formatting: ', h('code', {}, '**bold**'), ' ', h('code', {}, '*orange accent*'), ' ', h('code', {}, '[link](https://…)'), ' · blank line = new paragraph · ', h('code', {}, '- '), ' starts a list');
const ACCENT_HELP = h('span', {}, 'Wrap words in ', h('code', {}, '*asterisks*'), ' to set them in the orange serif italic.');

const stat = (label = 'Metrics') => ({ key: 'stats', label, type: 'list', inline: true, addLabel: 'Add metric', make: () => ({ value: '', label: '' }), fields: [{ key: 'value', label: 'Value', type: 'text', placeholder: '35%' }, { key: 'label', label: 'Label', type: 'text', placeholder: 'Conversion lift' }] });
const linkList = (key = 'links', label = 'Links') => ({ key, label, type: 'list', inline: true, addLabel: 'Add link', make: () => ({ label: '', url: '' }), fields: [{ key: 'label', label: 'Label', type: 'text', placeholder: 'Visit live site' }, { key: 'url', label: 'URL', type: 'url', placeholder: 'https://' }] });

const SITE = [{ key: 'site', type: 'group', fields: [
  { type: 'section', title: 'Identity' },
  { key: 'name', label: 'Your name', type: 'text' },
  { key: 'role', label: 'Role / title', type: 'text' },
  { key: 'initial', label: 'Monogram', type: 'text', help: 'One letter for the logo mark and page transitions.' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'timezone', label: 'Time zone', type: 'text', help: 'e.g. Africa/Lagos. Powers the live clock in the contact section.' },
  { type: 'section', title: 'Availability', help: 'The green pill in the hero and nav.' },
  { key: 'availability', type: 'group', fields: [
    { key: 'open', label: 'Open to work', type: 'toggle' },
    { key: 'label', label: 'Availability text', type: 'text' },
  ] },
  { type: 'section', title: 'Contact' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'showPhone', label: 'Show phone number on the site', type: 'toggle' },
  { key: 'resumeUrl', label: 'Résumé / CV', type: 'media', accept: 'application/pdf', kinds: ['document'], help: 'Upload a PDF. Visitors get “Download résumé” buttons in the hero, nav, contact section, About page and footer. Remove it to hide the buttons.' },
  linkList('socials', 'Social links'),
  { type: 'section', title: 'Look & feel' },
  { key: 'accent', label: 'Accent colour', type: 'color' },
  { key: 'defaultTheme', label: 'Default theme', type: 'select', options: [['system', 'Follow visitor’s system'], ['dark', 'Dark'], ['light', 'Light']] },
  { key: 'footerNote', label: 'Footer note', type: 'text' },
  { type: 'section', title: 'Search & sharing', help: 'How your site appears on Google, LinkedIn, Slack and X.' },
  { key: 'seoTitle', label: 'Page title', type: 'text', counter: [40, 65], wide: true },
  { key: 'seoDescription', label: 'Description', type: 'textarea', counter: [120, 160], wide: true },
  { key: 'siteUrl', label: 'Live site address', type: 'url', placeholder: 'https://victorajibodu.com', help: 'Needed for share-image previews and the sitemap.' },
  { key: 'ogImage', label: 'Share image', type: 'media', help: '1200 × 630 works best.' },
] }];

const HOME = [
  { type: 'section', title: 'Hero', help: 'The first thing a hiring manager reads. Keep it to two short lines.' },
  { key: 'hero', type: 'group', fields: [
    { key: 'primaryCta', label: 'Primary button', type: 'text' },
    { key: 'resumeCta', label: 'Résumé button', type: 'text', help: 'Shows only after you upload a résumé in Site settings.' },
    { key: 'lines', label: 'Headline lines', type: 'strings', wide: true, addLabel: 'Add line', help: ACCENT_HELP },
    { key: 'intro', label: 'Intro paragraph', type: 'md', wide: true },
    { key: 'secondaryCta', label: 'Secondary button', type: 'text' },
    { key: 'metrics', label: 'Headline metrics', type: 'list', inline: true, wide: true, addLabel: 'Add metric', make: () => ({ value: '', label: '' }), fields: [{ key: 'value', label: 'Value', type: 'text' }, { key: 'label', label: 'Label', type: 'text' }] },
  ] },
  { type: 'section', title: 'Prologue', help: 'The paragraph whose words light up as visitors scroll.' },
  { key: 'manifesto', type: 'group', fields: [
    { key: 'eyebrow', label: 'Label', type: 'text' },
    { key: 'text', label: 'Text', type: 'textarea', wide: true, rows: 4 },
  ] },
  { type: 'section', title: 'Moving strip' },
  { key: 'marquee', label: 'Words in the scrolling strip', type: 'tags', wide: true },
  { type: 'section', title: 'Work section' },
  { key: 'work', type: 'group', fields: [
    { key: 'eyebrow', label: 'Label', type: 'text' },
    { key: 'title', label: 'Headline', type: 'text', help: ACCENT_HELP },
    { key: 'intro', label: 'Intro', type: 'textarea', wide: true },
    { key: 'otherEyebrow', label: 'More work: label', type: 'text' },
    { key: 'otherTitle', label: 'More work: headline', type: 'text' },
    { key: 'otherIntro', label: 'More work: intro', type: 'textarea', wide: true },
  ] },
  { type: 'section', title: 'Epilogue (contact)' },
  { key: 'contact', type: 'group', fields: [
    { key: 'eyebrow', label: 'Label', type: 'text' },
    { key: 'cta', label: 'Button text', type: 'text' },
    { key: 'title', label: 'Headline', type: 'text', wide: true, help: ACCENT_HELP },
    { key: 'body', label: 'Text', type: 'textarea', wide: true },
  ] },
];

const ABOUT = [
  { key: 'about', type: 'group', fields: [
    { type: 'section', title: 'On the home page' },
    { key: 'eyebrow', label: 'Label', type: 'text' },
    { key: 'portrait', label: 'Portrait photo', type: 'media', help: 'A warm, well-lit photo builds trust fast. Portrait (4:5) works best.' },
    { key: 'title', label: 'Headline', type: 'textarea', wide: true, rows: 2, help: ACCENT_HELP },
    { key: 'preview', label: 'Short bio', type: 'md', wide: true },
    { key: 'stats', label: 'Numbers', type: 'list', inline: true, wide: true, addLabel: 'Add number', make: () => ({ value: '', label: '' }), fields: [{ key: 'value', label: 'Value', type: 'text' }, { key: 'label', label: 'Label', type: 'text' }] },
    { key: 'now', label: 'Right now', type: 'list', inline: true, wide: true, addLabel: 'Add item', make: () => ({ label: '', text: '' }), fields: [{ key: 'label', label: 'Label', type: 'text', placeholder: 'Leading' }, { key: 'text', label: 'Text', type: 'text' }] },
    { type: 'section', title: 'About page' },
    { key: 'pageTitle', label: 'Headline', type: 'text', wide: true, help: ACCENT_HELP },
    { key: 'pageLead', label: 'Lead', type: 'md', wide: true },
    { key: 'body', label: 'Full bio', type: 'md', wide: true, rows: 12 },
    { key: 'experience', label: 'Experience', type: 'list', wide: true, addLabel: 'Add role', make: () => ({ role: '', company: '', period: '', location: '' }), itemLabel: (x) => [x.role, x.company].filter(Boolean).join(' · '), fields: [
      { key: 'role', label: 'Role', type: 'text' }, { key: 'company', label: 'Company', type: 'text' },
      { key: 'period', label: 'Period', type: 'text', placeholder: 'Jul 2022 to Present' }, { key: 'location', label: 'Location', type: 'text' },
    ] },
    { key: 'capabilities', label: 'Capabilities', type: 'tags', wide: true },
    { key: 'domains', label: 'Domains', type: 'tags', wide: true },
  ] },
];

const METHOD = [
  { type: 'section', title: 'Method (horizontal “acts”)' },
  { key: 'process', type: 'group', fields: [
    { key: 'eyebrow', label: 'Label', type: 'text' },
    { key: 'title', label: 'Headline', type: 'text', help: ACCENT_HELP },
    { key: 'intro', label: 'Intro', type: 'textarea', wide: true },
    { key: 'steps', label: 'Acts', type: 'list', wide: true, addLabel: 'Add act', make: () => ({ label: '', title: '', body: '', chips: [] }), itemLabel: (x) => plain(x.label || x.title), fields: [
      { key: 'label', label: 'Label', type: 'text', placeholder: 'Act I · Understand' },
      { key: 'title', label: 'Headline', type: 'text' },
      { key: 'body', label: 'Text', type: 'textarea', wide: true },
      { key: 'chips', label: 'Proof points', type: 'tags', wide: true },
    ] },
  ] },
  { type: 'section', title: 'What I bring (services)' },
  { key: 'services', type: 'group', fields: [
    { key: 'eyebrow', label: 'Label', type: 'text' },
    { key: 'title', label: 'Headline', type: 'text' },
    { key: 'intro', label: 'Intro', type: 'textarea', wide: true },
    { key: 'items', label: 'Services', type: 'list', wide: true, addLabel: 'Add service', make: () => ({ title: '', body: '', list: [] }), itemLabel: (x) => x.title, fields: [
      { key: 'title', label: 'Title', type: 'text', wide: true },
      { key: 'body', label: 'Description', type: 'textarea', wide: true },
      { key: 'list', label: 'Bullet points', type: 'tags', wide: true },
    ] },
  ] },
];

const TESTIMONIALS = [
  { type: 'note', text: 'Portfolios with 2–3 short quotes from a PM, engineer or founder convert far better. The section sits on the home page after More work. Until you add quotes, it shows a card inviting past clients to send you one.' },
  { key: 'testimonials', type: 'group', fields: [
    { key: 'show', label: 'Show testimonials section', type: 'toggle' },
    { key: 'eyebrow', label: 'Label', type: 'text' },
    { key: 'title', label: 'Headline', type: 'text' },
    { key: 'requestTitle', label: '“Ask for a testimonial” card title', type: 'text', help: 'Card with a button that emails you. Clear the title to hide it.' },
    { key: 'requestCta', label: 'Card button', type: 'text' },
    { key: 'requestText', label: 'Card text', type: 'textarea', wide: true, rows: 2 },
    { key: 'items', label: 'Quotes', type: 'list', wide: true, addLabel: 'Add quote', make: () => ({ published: true, quote: '', name: '', role: '', avatar: '' }), itemLabel: (x) => `${x.published === false ? '(hidden) ' : ''}${x.name || plain(x.quote).slice(0, 60)}`, fields: [
      { key: 'published', label: 'Show on site', type: 'toggle' },
      { key: 'quote', label: 'Quote', type: 'textarea', wide: true },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'role', label: 'Role & company', type: 'text' },
      { key: 'avatar', label: 'Photo', type: 'media', wide: true },
    ] },
  ] },
];

const BLOCKS = {
  text: { label: 'Text', desc: 'A chapter heading and paragraphs', fields: [] },
  image: { label: 'Image / video', desc: 'Screens, flows, mockups or an MP4 loop', fields: [
    { key: 'src', label: 'Image or video', type: 'media', wide: true },
    { key: 'caption', label: 'Caption', type: 'text' },
    { key: 'wide', label: 'Extra wide on large screens', type: 'toggle' },
  ] },
  gallery: { label: 'Screens gallery', desc: 'A row of phone or app screens', fields: [
    { key: 'images', label: 'Screens', type: 'list', wide: true, addLabel: 'Add screen', make: () => ({ src: '', label: '' }), itemLabel: (x) => x.label, fields: [
      { key: 'src', label: 'Image', type: 'media', wide: true }, { key: 'label', label: 'Label', type: 'text' },
    ] },
  ] },
  quote: { label: 'Quote', desc: 'A user or stakeholder quote', fields: [
    { key: 'text', label: 'Quote', type: 'textarea', wide: true },
    { key: 'attribution', label: 'Who said it', type: 'text', wide: true, help: 'Anonymise research participants, e.g. “Civil servant, 34, Lagos”.' },
  ] },
  kpis: { label: 'Metrics', desc: 'Big animated numbers', fields: [
    { key: 'items', label: 'Metrics', type: 'list', inline: true, wide: true, addLabel: 'Add metric', make: () => ({ value: '', label: '' }), fields: [{ key: 'value', label: 'Value', type: 'text' }, { key: 'label', label: 'Label', type: 'text' }] },
  ] },
  cards: { label: 'Cards', desc: 'Problems, solutions, A/B tests, learnings', fields: [
    { key: 'style', label: 'Style', type: 'select', options: [['neutral', 'Neutral'], ['problem', 'Problems (red)'], ['solution', 'Solutions (project colour)'], ['learning', 'Learnings (outlined)']] },
    { key: 'columns', label: 'Columns', type: 'select', options: [['3', '3 columns'], ['2', '2 columns']] },
    { key: 'items', label: 'Cards', type: 'list', wide: true, addLabel: 'Add card', make: () => ({ label: '', body: '' }), itemLabel: (x) => plain(x.label), fields: [
      { key: 'label', label: 'Label', type: 'text', wide: true }, { key: 'body', label: 'Text', type: 'md', wide: true },
    ] },
  ] },
  callout: { label: 'Callout', desc: 'A highlighted box for the key idea', fields: [
    { key: 'label', label: 'Box label', type: 'text', wide: true },
    { key: 'text', label: 'Box text', type: 'md', wide: true },
  ] },
  steps: { label: 'Steps', desc: 'A numbered flow', fields: [
    { key: 'items', label: 'Steps', type: 'list', wide: true, addLabel: 'Add step', make: () => ({ title: '', body: '' }), itemLabel: (x) => x.title, fields: [
      { key: 'title', label: 'Title', type: 'text' }, { key: 'body', label: 'Text', type: 'text' },
    ] },
  ] },
  palette: { label: 'Palette & specs', desc: 'Colour swatches and system specs', fields: [
    { key: 'colors', label: 'Colours', type: 'list', inline: true, wide: true, addLabel: 'Add colour', make: () => ({ hex: '#000000', name: '' }), fields: [{ key: 'hex', label: 'Colour', type: 'color' }, { key: 'name', label: 'Name', type: 'text' }] },
    { key: 'specs', label: 'Specs', type: 'list', inline: true, wide: true, addLabel: 'Add spec', make: () => ({ label: '', value: '' }), fields: [{ key: 'label', label: 'Label', type: 'text' }, { key: 'value', label: 'Value', type: 'text' }] },
  ] },
  embed: { label: 'Prototype embed', desc: 'Figma, YouTube, Vimeo or Loom', fields: [
    { key: 'url', label: 'Share link', type: 'url', wide: true, placeholder: 'https://www.figma.com/proto/…' },
    { key: 'ratio', label: 'Shape', type: 'select', options: [['16:9', 'Landscape 16:9'], ['4:3', '4:3'], ['1:1', 'Square'], ['9:16', 'Phone 9:16']] },
    { key: 'caption', label: 'Caption', type: 'text' },
  ] },
};
const BLOCK_COMMON = [
  { key: 'eyebrow', label: 'Chapter label', type: 'text', help: 'Adding a label makes this block a chapter in the side navigation.' },
  { key: 'heading', label: 'Heading', type: 'text', help: ACCENT_HELP },
  { key: 'body', label: 'Text', type: 'md', wide: true },
];

const PROJECT_CARD = [
  { key: 'title', label: 'Project title', type: 'text', wide: true, help: ACCENT_HELP },
  { key: 'kind', label: 'Type', type: 'select', rerender: true, options: [['case-study', 'Case study: full story page'], ['card', 'Project card: More work grid']] },
  { key: 'published', label: 'Show on site', type: 'toggle', help: 'Turn off to hide this project without deleting it.' },
  { key: 'slug', label: 'Page address', type: 'slug', help: 'yoursite.com/work/…' },
  { key: 'category', label: 'Category line', type: 'text', placeholder: 'Mobile · Fintech' },
  { key: 'status', label: 'Status', type: 'text', placeholder: 'Shipped' },
  { key: 'year', label: 'Year / timeline', type: 'text', placeholder: '2025' },
  { key: 'accent', label: 'Project colour', type: 'color', help: 'Themes the card and the case study.' },
  { key: 'tags', label: 'Tags', type: 'tags' },
  { key: 'hook', label: 'Hook: one line that makes them click', type: 'textarea', wide: true, rows: 2, counter: [60, 140] },
  { key: 'summary', label: 'Summary', type: 'md', wide: true },
  { key: 'cover', label: 'Cover image or video', type: 'media', wide: true },
  { key: 'coverFit', label: 'Cover display', type: 'select', options: [['', 'Fill the frame (crops edges)'], ['contain', 'Framed: shows the whole image']] },
  { ...stat('Card metrics'), wide: true, help: 'Three numbers work best.' },
  { ...linkList(), wide: true, help: 'The first link opens from a project card; case studies show all of them.' },
];

const PROJECT_DETAILS = [
  { key: 'heroImage', label: 'Hero image', type: 'media', wide: true, help: 'Falls back to the cover image.' },
  { key: 'meta', label: 'Facts row', type: 'list', inline: true, wide: true, addLabel: 'Add fact', make: () => ({ label: '', value: '' }), fields: [{ key: 'label', label: 'Label', type: 'text', placeholder: 'Role' }, { key: 'value', label: 'Value', type: 'text' }], help: 'Role, team, timeline, platform, scope.' },
  { type: 'section', title: 'At a glance', help: 'Recruiters skim this first. One or two sentences each.' },
  { key: 'glance', type: 'group', fields: [
    { key: 'problem', label: 'The problem', type: 'textarea', wide: true, rows: 2 },
    { key: 'solution', label: 'What I did', type: 'textarea', wide: true, rows: 2 },
    { key: 'impact', label: 'The impact', type: 'textarea', wide: true, rows: 2 },
  ] },
];

/* ============================================================ field renderers */

function renderFields(fields, obj, ctx = {}) {
  const frag = document.createDocumentFragment();
  for (const f of fields) frag.append(renderField(f, obj, ctx));
  return frag;
}

function renderField(f, obj, ctx) {
  if (f.type === 'section') return h('div.form-section', {}, h('h3', {}, f.title), f.help ? h('p', {}, f.help) : null);
  if (f.type === 'note') return h('div.note.is-info', {}, f.text);
  if (f.type === 'group') {
    if (!obj[f.key] || typeof obj[f.key] !== 'object') obj[f.key] = {};
    return h('div.group', {}, renderFields(f.fields, obj[f.key], ctx));
  }

  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  const set = (v) => {
    obj[f.key] = v;
    markDirty();
    f.onChange?.(v, obj);
    if (f.rerender) ctx.rerender?.();
  };
  const counter = f.counter ? h('span.counter') : null;
  const updateCounter = (v) => {
    if (!counter) return;
    const n = String(v || '').length;
    counter.textContent = `${n} / ${f.counter[1]}`;
    counter.classList.toggle('is-warn', n > 0 && (n < f.counter[0] || n > f.counter[1]));
  };
  const label = f.type === 'toggle' ? null : h('label.field-label', { htmlFor: id }, f.label, counter);
  let control;

  switch (f.type) {
    case 'text': case 'url': case 'email': {
      control = h('input.input', { id, type: f.type === 'text' ? 'text' : f.type, value: obj[f.key] ?? '', placeholder: f.placeholder || '', oninput: (e) => { set(e.target.value); updateCounter(e.target.value); } });
      break;
    }
    case 'slug': {
      control = h('input.input', { id, value: obj[f.key] ?? '', placeholder: slugify(obj.title || ''), onchange: (e) => { e.target.value = slugify(e.target.value); set(e.target.value); } });
      break;
    }
    case 'textarea': case 'md': {
      control = h(`textarea.textarea${f.type === 'md' ? '.is-md' : ''}`, { id, rows: f.rows || (f.type === 'md' ? 5 : 3), placeholder: f.placeholder || '', oninput: (e) => { set(e.target.value); updateCounter(e.target.value); } });
      control.value = obj[f.key] ?? '';
      break;
    }
    case 'toggle': {
      control = h('label.toggle', {}, h('input', { type: 'checkbox', checked: obj[f.key] !== false && obj[f.key] != null ? Boolean(obj[f.key]) : false, onchange: (e) => set(e.target.checked) }), h('span.track'), h('span', {}, f.label));
      break;
    }
    case 'select': {
      const cur = obj[f.key] == null ? '' : String(obj[f.key]);
      control = h('select.select', { id, onchange: (e) => set(f.key === 'columns' ? Number(e.target.value) : e.target.value) }, f.options.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
      break;
    }
    case 'color': {
      const valid = (v) => /^#[0-9a-f]{6}$/i.test(v);
      const text = h('input.input', { id, value: obj[f.key] || '', placeholder: '#EF5A28', oninput: (e) => { const v = e.target.value.trim(); set(v); if (valid(v)) picker.value = v; } });
      const picker = h('input', { type: 'color', value: valid(obj[f.key]) ? obj[f.key] : '#000000', oninput: (e) => { text.value = e.target.value.toUpperCase(); set(text.value); }, 'aria-label': `${f.label} picker` });
      control = h('div.color', {}, picker, text);
      break;
    }
    case 'tags': control = tagsField(f, obj, set, id); break;
    case 'strings': control = stringsField(f, obj); break;
    case 'media': control = mediaField(f, obj, set); break;
    case 'list': control = listField(f, obj, ctx); break;
    case 'blocks': control = blocksField(f, obj, ctx); break;
    default: control = h('div', {}, `Unknown field type ${f.type}`);
  }
  updateCounter(obj[f.key]);
  const help = f.help ? h('div.field-help', {}, f.help instanceof Node ? f.help.cloneNode(true) : f.help) : null;
  const md = f.type === 'md' ? h('div.field-help', {}, MD_HELP.cloneNode(true)) : null;
  const wide = f.wide || ['list', 'blocks', 'strings'].includes(f.type);
  return h(`div.field${wide ? '.wide' : ''}`, {}, label, control, help, md);
}

function tagsField(f, obj, set, id) {
  if (!Array.isArray(obj[f.key])) obj[f.key] = [];
  const arr = obj[f.key];
  const box = h('div.tags');
  const input = h('input', { id, placeholder: 'Type and press Enter', onkeydown: (e) => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      arr.push(input.value.trim());
      input.value = '';
      set(arr);
      draw();
    } else if (e.key === 'Backspace' && !input.value && arr.length) {
      arr.pop();
      set(arr);
      draw();
    }
  }, onblur: () => { if (input.value.trim()) { arr.push(input.value.trim()); input.value = ''; set(arr); draw(); } } });
  const draw = () => {
    box.replaceChildren(...arr.map((t, i) => h('span.chip', {}, t, h('button', { type: 'button', 'aria-label': `Remove ${t}`, onclick: () => { arr.splice(i, 1); set(arr); draw(); } }, '✕'))), input);
  };
  box.addEventListener('click', (e) => { if (e.target === box) input.focus(); });
  draw();
  return box;
}

function stringsField(f, obj) {
  if (!Array.isArray(obj[f.key])) obj[f.key] = [];
  const arr = obj[f.key];
  const box = h('div.strings');
  const draw = () => {
    box.replaceChildren(
      ...arr.map((v, i) => h('div.string-row', {},
        h('input.input', { value: v, oninput: (e) => { arr[i] = e.target.value; markDirty(); } }),
        h('button.icon-btn', { type: 'button', title: 'Move up', disabled: i === 0, onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; markDirty(); draw(); } }, '↑'),
        h('button.icon-btn.is-bad', { type: 'button', title: 'Remove', onclick: () => { arr.splice(i, 1); markDirty(); draw(); } }, '✕'),
      )),
      h('button.btn-add', { type: 'button', onclick: () => { arr.push(''); markDirty(); draw(); box.querySelectorAll('input')[arr.length - 1]?.focus(); } }, '+ ', f.addLabel || 'Add'),
    );
  };
  draw();
  return box;
}

function mediaField(f, obj, set) {
  const box = h('div.media-field');
  const kinds = f.kinds || ['image', 'video'];
  const accept = f.accept || 'image/*,video/mp4,video/webm';
  const fileInput = h('input', { type: 'file', accept, hidden: true, onchange: async (e) => {
    if (!e.target.files.length) return;
    try {
      const [file] = await uploadFiles(e.target.files);
      set(file.url);
      draw();
    } catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
  } });
  const draw = () => {
    const v = obj[f.key] || '';
    const thumb = !v ? 'No file' : isVideo(v) ? h('video', { src: v, muted: true, autoplay: true, loop: true, playsInline: true }) : isPdf(v) ? 'PDF' : h('img', { src: v, alt: '' });
    box.replaceChildren(
      h('div.media-thumb', {}, thumb),
      h('div.media-side', {},
        v ? h('div.media-name', { title: v }, v) : h('div.field-help', {}, 'Drop a file here, upload, or pick from your library.'),
        h('div.media-actions', {},
          h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => fileInput.click() }, 'Upload'),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => pickMedia(kinds).then((url) => { if (url) { set(url); draw(); } }) }, 'Choose from library'),
          v ? h('button.btn.btn-danger.btn-sm', { type: 'button', onclick: () => { set(''); draw(); } }, 'Remove') : null,
        ),
        fileInput,
      ),
    );
  };
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('is-drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('is-drop'));
  box.addEventListener('drop', async (e) => {
    e.preventDefault();
    box.classList.remove('is-drop');
    if (!e.dataTransfer.files.length) return;
    try {
      const [file] = await uploadFiles([e.dataTransfer.files[0]]);
      set(file.url);
      draw();
    } catch (err) { toast(err.message, 'error'); }
  });
  draw();
  return box;
}

// Reorderable list of objects. Inline lists show fields in one row; others collapse into cards.
function listField(f, obj, ctx) {
  if (!Array.isArray(obj[f.key])) obj[f.key] = [];
  const arr = obj[f.key];
  const box = h('div.list');
  let dragFrom = null;

  const move = (from, to) => {
    if (to < 0 || to >= arr.length || from === to) return;
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    markDirty();
    draw();
  };
  const actions = (i) => h('div.li-actions', { onclick: (e) => e.stopPropagation() },
    h('button.icon-btn', { type: 'button', title: 'Move up', disabled: i === 0, onclick: () => move(i, i - 1) }, '↑'),
    h('button.icon-btn', { type: 'button', title: 'Move down', disabled: i === arr.length - 1, onclick: () => move(i, i + 1) }, '↓'),
    f.inline ? null : h('button.icon-btn', { type: 'button', title: 'Duplicate', onclick: () => { const c = clone(arr[i]); arr.splice(i + 1, 0, c); openItems.add(c); markDirty(); draw(); } }, '⧉'),
    h('button.icon-btn.is-bad', { type: 'button', title: 'Remove', onclick: () => { arr.splice(i, 1); markDirty(); draw(); } }, '✕'),
  );
  const dnd = (el, i) => {
    el.addEventListener('dragstart', (e) => { dragFrom = i; el.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
    el.addEventListener('dragend', () => { el.classList.remove('is-dragging'); el.draggable = false; });
    el.addEventListener('dragover', (e) => { if (dragFrom == null) return; e.preventDefault(); el.classList.add('is-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('is-over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('is-over'); if (dragFrom != null) move(dragFrom, i); dragFrom = null; });
  };
  const handle = (el) => h('span.li-handle', { title: 'Drag to reorder', onmousedown: () => { el.draggable = true; }, onmouseup: () => { el.draggable = false; } }, '⋮⋮');

  const fieldsFor = (item) => (f.fieldsFor ? f.fieldsFor(item) : f.fields);

  const draw = () => {
    box.replaceChildren();
    arr.forEach((item, i) => {
      if (f.inline) {
        const row = h('div.li-inline');
        row.append(handle(row), h('div.inline-fields', {}, renderFields(fieldsFor(item), item, ctx)), actions(i));
        dnd(row, i);
        box.append(row);
        return;
      }
      const open = openItems.has(item);
      const card = h(`div.li${open ? '.is-open' : ''}`);
      const title = h('span.li-title');
      const setTitle = () => {
        const t = (f.itemLabel ? f.itemLabel(item, i) : '') || '';
        title.replaceChildren(t || h('span.muted', {}, `Untitled ${f.itemNoun || 'item'}`));
      };
      setTitle();
      const head = h('div.li-head', { onclick: () => { open ? openItems.delete(item) : openItems.add(item); draw(); } },
        handle(card), h('span.li-caret', {}, '›'),
        f.badge ? h('span.li-badge', {}, f.badge(item)) : null,
        title, actions(i));
      card.append(head);
      if (open) {
        const body = h('div.li-body', {}, renderFields(fieldsFor(item), item, { ...ctx, rerender: draw }));
        body.addEventListener('input', setTitle);
        card.append(body);
      }
      dnd(card, i);
      box.append(card);
    });
    if (f.addMenu) box.append(f.addMenu((item) => { arr.push(item); openItems.add(item); markDirty(); draw(); }));
    else box.append(h('button.btn-add', { type: 'button', onclick: () => { const item = f.make ? f.make() : {}; arr.push(item); openItems.add(item); markDirty(); draw(); } }, '+ ', f.addLabel || 'Add item'));
  };
  draw();
  return box;
}

function blocksField(f, obj, ctx) {
  return listField({
    ...f,
    itemNoun: 'block',
    badge: (b) => BLOCKS[b.type]?.label || b.type,
    itemLabel: (b) => plain(b.eyebrow ? `${b.eyebrow}: ${b.heading || ''}` : b.heading || b.caption || b.label || b.text || ''),
    fieldsFor: (b) => [...BLOCK_COMMON, ...(BLOCKS[b.type]?.fields || [])],
    addMenu: (add) => h('button.btn-add', { type: 'button', onclick: () => {
      const close = modal({
        title: 'Add a story block',
        wide: true,
        body: h('div.add-menu', {}, Object.entries(BLOCKS).map(([type, def]) => h('button.add-opt', { type: 'button', onclick: () => { close(); add(newBlock(type)); } }, h('strong', {}, def.label), h('span', {}, def.desc)))),
      });
    } }, '+ Add block'),
  }, obj, ctx);
}

function newBlock(type) {
  const b = { type, eyebrow: '', heading: '', body: '' };
  if (type === 'cards') Object.assign(b, { style: 'neutral', columns: 3, items: [{ label: '', body: '' }] });
  if (type === 'kpis') b.items = [{ value: '', label: '' }];
  if (type === 'steps') b.items = [{ title: '', body: '' }];
  if (type === 'gallery') b.images = [];
  if (type === 'palette') Object.assign(b, { colors: [], specs: [] });
  if (type === 'embed') b.ratio = '16:9';
  return b;
}

/* ============================================================ media picker */

function mediaCard(m, { pick, onDelete } = {}) {
  const thumb = m.kind === 'video' ? h('video', { src: m.url, muted: true, loop: true, playsInline: true, onmouseenter: (e) => e.target.play(), onmouseleave: (e) => e.target.pause() }) : m.kind === 'document' ? 'PDF' : h('img', { src: m.url, alt: '', loading: 'lazy' });
  return h(`div.m-card${pick ? '.is-pick' : ''}`, { onclick: pick ? () => pick(m.url) : null },
    h('div.m-thumb', {}, thumb),
    h('div.m-info', {}, h('div.m-name', { title: m.name }, m.name), h('div.m-meta', {}, [m.dims ? `${m.dims.w}×${m.dims.h}` : m.kind, fmtBytes(m.size), m.used ? `used ${m.used}×` : 'unused'].join(' · '))),
    pick ? null : h('div.m-actions', {},
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => navigator.clipboard.writeText(m.url).then(() => toast('Link copied.')) }, 'Copy link'),
      h('button.btn.btn-danger.btn-sm', { type: 'button', onclick: () => onDelete?.(m) }, 'Delete')),
  );
}

function pickMedia(kinds = ['image', 'video']) {
  return new Promise((resolve) => {
    let done = false;
    const grid = h('div.media-grid');
    const finish = (url) => { if (!done) { done = true; resolve(url); } };
    const draw = async (force) => {
      grid.replaceChildren(h('div.empty', {}, 'Loading…'));
      const list = (await loadMedia(force)).filter((m) => kinds.includes(m.kind));
      grid.replaceChildren(...(list.length ? list.map((m) => mediaCard(m, { pick: (url) => { finish(url); close(); } })) : [h('div.empty', {}, 'Nothing here yet — upload a file.')]));
    };
    const up = h('input', { type: 'file', multiple: true, hidden: true, accept: kinds.includes('document') ? 'application/pdf' : 'image/*,video/mp4,video/webm', onchange: async (e) => {
      try { await uploadFiles(e.target.files); draw(true); } catch (err) { toast(err.message, 'error'); }
    } });
    const close = modal({
      title: 'Choose a file',
      wide: true,
      body: h('div', {}, h('div.drop', {}, h('strong', {}, 'Upload new'), ' ', h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => up.click() }, 'Browse files'), up), grid),
      onClose: () => finish(null),
    });
    draw();
  });
}

/* ============================================================ views */

const NAV = [
  ['Overview', [['', '◎', 'Dashboard']]],
  ['Content', [['projects', '▦', 'Projects', () => state.content.projects.length], ['home', '⌂', 'Home page'], ['about', '☺', 'About'], ['method', '≡', 'Method & services'], ['testimonials', '❝', 'Testimonials', () => state.content.testimonials?.items?.length || '']]],
  ['Settings', [['site', '⚙', 'Site settings'], ['media', '▣', 'Media library'], ['history', '↺', 'History']]],
];

function drawNav(active) {
  $('#sbNav').replaceChildren(...NAV.flatMap(([group, items]) => [
    h('div.sb-group', {}, group),
    ...items.map(([r, ico, label, count]) => h(`a.sb-item${active === r ? '.is-active' : ''}`, { href: `#/${r}` }, h('span.ico', {}, ico), label, count ? h('span.count', {}, count()) : null)),
  ]));
}

function setCrumbs(...parts) {
  $('#crumbs').replaceChildren(...parts.flatMap((p, i) => {
    const node = typeof p === 'string' ? h('strong', {}, p) : h('a', { href: p[1] }, p[0]);
    return i ? [h('span', {}, '/'), node] : [node];
  }));
}

function pageHead(title, sub, actions = []) {
  return h('div.page-head', {}, h('div', {}, h('h1', {}, title), sub ? h('p', {}, sub) : null), actions.length ? h('div.actions', {}, actions) : null);
}

let currentPreviewPath = '/';

function formView(title, sub, schema, previewPath = '/') {
  currentPreviewPath = previewPath;
  setCrumbs(title);
  const panel = h('div.panel', {}, h('div.form', {}, renderFields(schema, state.content)));
  return [pageHead(title, sub), panel];
}

function healthChecks(c) {
  const studies = c.projects.filter((p) => p.published && p.kind === 'case-study');
  const checks = [
    [Boolean(c.about.portrait), 'Add a portrait photo', 'People hire people. A real photo on the About section builds trust instantly.', '#/about'],
    [(c.testimonials.items || []).filter((t) => t.quote && t.published !== false).length >= 2, 'Add 2–3 testimonials', 'A PM or engineer vouching for you is the strongest proof on a portfolio.', '#/testimonials'],
    [Boolean(c.site.resumeUrl), 'Upload your résumé (PDF)', 'Recruiters look for it within the first minute.', '#/site'],
    [Boolean(c.site.siteUrl), 'Set your live site address', 'Enables share-image previews on LinkedIn and Slack.', '#/site'],
    [(c.site.seoDescription || '').length >= 100, 'Write a search description', 'Shown on Google and link previews.', '#/site'],
    [studies.length >= 3, 'Publish at least 3 case studies', 'Three strong stories beat eight thin ones.', '#/projects'],
  ];
  for (const p of studies) {
    const g = p.glance || {};
    const missing = [];
    if (!p.cover) missing.push('cover');
    if ((p.stats || []).length < 3) missing.push('3 metrics');
    if (!(g.problem && g.solution && g.impact)) missing.push('at-a-glance');
    if (!(p.meta || []).length) missing.push('facts row');
    if (!(p.blocks || []).some((b) => /reflect|learn/i.test(`${b.eyebrow} ${b.heading}`))) missing.push('reflection');
    checks.push([!missing.length, `${plain(p.title)} is story-complete`, missing.length ? `Missing: ${missing.join(', ')}.` : 'Cover, metrics, glance, facts and reflection all in place.', `#/projects/${p.id}`]);
  }
  return checks;
}

function dashboardView() {
  currentPreviewPath = '/';
  setCrumbs('Dashboard');
  const c = state.content;
  const published = c.projects.filter((p) => p.published);
  const checks = healthChecks(c);
  const done = checks.filter((x) => x[0]).length;
  const pct = Math.round((done / checks.length) * 100);
  return [
    pageHead(`Hi, ${(c.site.name || '').split(' ')[0] || 'there'}.`, 'Edit anything, preview it, then press Publish. Every publish is backed up — you can roll back from History.'),
    h('div.dash', {},
      h('div.kpi', {}, h('strong', {}, published.filter((p) => p.kind === 'case-study').length), h('span', {}, 'Case studies live')),
      h('div.kpi', {}, h('strong', {}, published.filter((p) => p.kind === 'card').length), h('span', {}, 'Project cards live')),
      h('div.kpi', {}, h('strong', {}, c.projects.length - published.length), h('span', {}, 'Hidden projects')),
      h('div.kpi', {}, h('strong', {}, `${c._rev || 0}`), h('span', {}, 'Published versions')),
    ),
    h('div.two-col', {},
      h('div.panel', {},
        h('div.score', {}, h('div.score-ring', { style: `--p:${pct}` }, h('span', {}, `${pct}%`)), h('div', {}, h('strong', {}, 'Portfolio strength'), h('p.field-help', {}, `${done} of ${checks.length} hiring-ready checks done.`))),
        h('div.health', {}, checks.map(([ok, title, text, link]) => h('div.health-row', {},
          h(`span.health-ico.${ok ? 'ok' : 'todo'}`, {}, ok ? '✓' : '!'),
          h('div', {}, h('strong', {}, title), h('p', {}, text)),
          ok ? null : h('a.btn.btn-ghost.btn-sm', { href: link }, 'Fix'))))),
      h('div.panel', {},
        h('div.form-section', {}, h('h3', {}, 'Quick actions')),
        h('div.quick', { style: 'margin-top:12px' },
          h('a', { href: '#/projects/new' }, 'Add a new project', h('span', {}, '→')),
          h('a', { href: '#/home' }, 'Edit the hero headline', h('span', {}, '→')),
          h('a', { href: '#/media' }, 'Upload images', h('span', {}, '→')),
          h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'Open the live site', h('span', {}, '↗')),
        )),
    ),
  ];
}

function projectsView() {
  currentPreviewPath = '/#work';
  setCrumbs('Projects');
  const arr = state.content.projects;
  const list = h('div.proj-list');
  let dragFrom = null;
  const draw = () => {
    list.replaceChildren(...arr.map((p, i) => {
      const thumb = p.cover ? (isVideo(p.cover) ? h('video', { src: p.cover, muted: true }) : h('img', { src: p.cover, alt: '' })) : (plain(p.title)[0] || '?');
      const row = h(`div.proj`, {},
        h('span.li-handle', { title: 'Drag to reorder', onmousedown: () => { row.draggable = true; }, onmouseup: () => { row.draggable = false; } }, '⋮⋮'),
        h('div.proj-thumb', { style: `background:${p.accent || '#0E1830'}` }, thumb),
        h('div.proj-main', {},
          h('a.proj-title', { href: `#/projects/${p.id}` }, plain(p.title) || 'Untitled project'),
          h('div.proj-meta', {},
            h(`span.badge${p.kind === 'case-study' ? '.is-case' : ''}`, {}, p.kind === 'case-study' ? 'Case study' : 'Card'),
            h(`span.badge${p.published ? '.is-live' : '.is-draft'}`, {}, p.published ? 'On site' : 'Hidden'),
            h('span', {}, p.category || ''))),
        h('div.proj-actions', {},
          h('label.toggle', { title: 'Show on site' }, h('input', { type: 'checkbox', checked: p.published, onchange: (e) => { p.published = e.target.checked; markDirty(); draw(); } }), h('span.track')),
          h('a.btn.btn-ghost.btn-sm', { href: `#/projects/${p.id}` }, 'Edit'),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => preview(p.kind === 'case-study' ? `/work/${p.slug}` : '/#work') }, 'Preview'),
          h('button.icon-btn', { type: 'button', title: 'Duplicate', onclick: () => { const c = clone(p); c.id = uid(); c.slug = `${p.slug}-copy`; c.title = `${p.title} (copy)`; c.published = false; arr.splice(i + 1, 0, c); markDirty(); draw(); } }, '⧉'),
          h('button.icon-btn.is-bad', { type: 'button', title: 'Delete', onclick: async () => {
            if (await confirmBox('Delete project?', `“${plain(p.title)}” will be removed when you publish. You can restore it later from History.`)) { arr.splice(i, 1); markDirty(); draw(); drawNav('projects'); }
          } }, '✕')),
      );
      row.addEventListener('dragstart', (e) => { dragFrom = i; row.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      row.addEventListener('dragend', () => { row.classList.remove('is-dragging'); row.draggable = false; });
      row.addEventListener('dragover', (e) => { if (dragFrom == null) return; e.preventDefault(); row.classList.add('is-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('is-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.classList.remove('is-over');
        if (dragFrom != null && dragFrom !== i) { const [x] = arr.splice(dragFrom, 1); arr.splice(i, 0, x); markDirty(); draw(); }
        dragFrom = null;
      });
      return row;
    }));
    if (!arr.length) list.append(h('div.empty', {}, 'No projects yet.'));
  };
  draw();
  return [
    pageHead('Projects', 'Drag to reorder. Case studies appear as the stacked story cards; project cards appear under “Side quests”.', [
      h('button.btn.btn-accent', { type: 'button', onclick: () => newProjectDialog() }, '+ New project'),
    ]),
    list,
  ];
}

function newProjectDialog() {
  const data = { title: '', kind: 'case-study' };
  const title = h('input.input', { placeholder: 'e.g. Chopbaze *Marketplace.*', oninput: (e) => { data.title = e.target.value; } });
  const radio = (v, t, s) => h('label.radio-card', {}, h('input', { type: 'radio', name: 'kind', value: v, checked: data.kind === v, onchange: () => { data.kind = v; } }), h('strong', {}, t), h('span', {}, s));
  modal({
    title: 'New project',
    body: [
      h('div.field', {}, h('label.field-label', {}, 'Title'), title, h('div.field-help', {}, ACCENT_HELP.cloneNode(true))),
      h('div.radio-cards', {}, radio('case-study', 'Case study', 'Full story page with chapters. Starts from a proven template.'), radio('card', 'Project card', 'A compact card in “Side quests”. No page.')),
    ],
    actions: [
      { label: 'Cancel', run: (c) => c() },
      { label: 'Create project', kind: 'btn-accent', run: (c) => {
        if (!data.title.trim()) { title.focus(); return; }
        const p = newProject(data.title.trim(), data.kind);
        state.content.projects.push(p);
        markDirty();
        c();
        location.hash = `#/projects/${p.id}`;
      } },
    ],
  });
}

function newProject(title, kind) {
  const p = {
    id: uid(), slug: slugify(title), published: false, kind, title,
    category: '', status: 'Shipped', year: '', tags: [], accent: '#EF5A28',
    hook: '', summary: '', cover: '', stats: [{ value: '', label: '' }, { value: '', label: '' }, { value: '', label: '' }],
    meta: [{ label: 'Role', value: '' }, { label: 'Timeline', value: '' }, { label: 'Platform', value: '' }, { label: 'Scope', value: '' }],
    links: [], glance: { problem: '', solution: '', impact: '' }, blocks: [],
  };
  if (kind === 'case-study') {
    p.blocks = [
      { type: 'kpis', eyebrow: 'Impact', heading: '', body: '', items: [{ value: '', label: '' }, { value: '', label: '' }, { value: '', label: '' }] },
      { type: 'text', eyebrow: 'The problem', heading: 'What was broken, and *why it mattered.*', body: 'Set the scene: the business, the users, and the moment things had to change.' },
      { type: 'text', eyebrow: 'Research', heading: 'What I learned *before designing anything.*', body: 'Who you spoke to, how many, and the one insight that changed the direction.' },
      { type: 'quote', eyebrow: '', heading: '', body: '', text: 'A real quote from a user that captures the problem.', attribution: 'Role, age, city' },
      { type: 'callout', eyebrow: 'The turning point', heading: 'The decision that *changed the outcome.*', body: 'The trade-off you made, who you convinced, and how.', label: 'The solution', text: '' },
      { type: 'image', eyebrow: 'Design', heading: 'From flows to *final screens.*', body: '', src: '', caption: '', wide: false },
      { type: 'text', eyebrow: 'Outcome', heading: 'What *moved.*', body: 'Numbers first, then what they meant for the business and the users.' },
      { type: 'cards', eyebrow: 'Reflection', heading: 'What this project *taught me.*', body: '', style: 'learning', columns: 3, items: [{ label: '', body: '' }, { label: '', body: '' }, { label: '', body: '' }] },
    ];
  }
  return p;
}

function projectView(id, tab = 'card') {
  const p = state.content.projects.find((x) => x.id === id);
  if (!p) {
    setCrumbs(['Projects', '#/projects'], 'Not found');
    return [h('div.empty', {}, 'This project no longer exists. ', h('a', { href: '#/projects' }, 'Back to projects'))];
  }
  currentPreviewPath = p.kind === 'case-study' ? `/work/${p.slug || slugify(p.title)}` : '/#work';
  setCrumbs(['Projects', '#/projects'], plain(p.title) || 'Untitled');
  const isCase = p.kind === 'case-study';
  const tabs = [['card', 'Card & basics'], ...(isCase ? [['details', 'Case study header'], ['story', 'Story blocks', (p.blocks || []).length]] : [])];
  if (!tabs.some(([t]) => t === tab)) tab = 'card';
  const container = h('div');
  const rerender = () => { const y = scrollY; route(true); scrollTo(0, y); };
  const body = {
    card: () => h('div.panel', {}, h('div.form', {}, renderFields(PROJECT_CARD, p, { rerender }))),
    details: () => h('div.panel', {}, h('div.form', {}, renderFields(PROJECT_DETAILS, p, { rerender }))),
    story: () => h('div', {},
      h('div.note.is-info', { style: 'margin-bottom:14px' }, 'Tell it as a story: problem → research → turning point → design → outcome → reflection. Blocks with a chapter label appear in the side navigation.'),
      renderField({ key: 'blocks', type: 'blocks' }, p, { rerender })),
  }[tab]();
  container.append(
    pageHead(plain(p.title) || 'Untitled project', isCase ? 'A full case-study page with its own address.' : 'A compact card in the “Side quests” grid.', [
      h('button.btn.btn-ghost', { type: 'button', onclick: () => preview(currentPreviewPath) }, 'Preview this'),
      p.published && isCase ? h('a.btn.btn-ghost', { href: `/work/${p.slug}`, target: '_blank', rel: 'noopener' }, 'View live ↗') : null,
    ]),
    h('div.tabs', {}, tabs.map(([t, label, n]) => h(`a.tab${t === tab ? '.is-active' : ''}`, { href: `#/projects/${id}/${t}` }, label, n != null ? h('span.n', {}, n) : null))),
    body,
  );
  return [container];
}

async function mediaView() {
  currentPreviewPath = '/';
  setCrumbs('Media library');
  const grid = h('div.media-grid', {}, h('div.empty', {}, 'Loading…'));
  const draw = async (force) => {
    const list = await loadMedia(force);
    grid.replaceChildren(...(list.length ? list.map((m) => mediaCard(m, { onDelete: async (x) => {
      const warn = x.used ? ` It is used ${x.used}× on your site. Those spots will show nothing until you replace it.` : '';
      if (!(await confirmBox('Delete file?', `${x.name} will be permanently deleted.${warn}`))) return;
      try { await api(`/media/${encodeURIComponent(x.name)}`, { method: 'DELETE' }); toast('Deleted.'); draw(true); } catch (e) { toast(e.message, 'error'); }
    } })) : [h('div.empty', {}, 'No files yet.')]));
  };
  const input = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/*,video/mp4,video/webm,application/pdf', onchange: async (e) => {
    try { await uploadFiles(e.target.files); draw(true); } catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
  } });
  const drop = h('div.drop', {}, h('strong', {}, 'Drop images, videos or PDFs here'), h('div', { style: 'margin:8px 0' }, `JPG, PNG, WebP, GIF, AVIF, MP4, WebM or PDF · up to ${state.mode === 'github' ? 4 : 40} MB each`), h('button.btn.btn-ghost', { type: 'button', onclick: () => input.click() }, 'Browse files'), input);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-drop'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-drop'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('is-drop');
    try { await uploadFiles(e.dataTransfer.files); draw(true); } catch (err) { toast(err.message, 'error'); }
  });
  draw(true).catch((e) => toast(e.message, 'error'));
  return [pageHead('Media library', 'Tip: export images at 2× the size they appear, as WebP or JPG under ~400 KB. Short MP4 loops make great covers.'), drop, grid];
}

async function historyView() {
  currentPreviewPath = '/';
  setCrumbs('History');
  const box = h('div.panel', {}, h('div.empty', {}, 'Loading…'));
  const list = await api('/backups');
  box.replaceChildren(list.length ? h('div.hist', {}, list.map((b) => h('div.hist-row', {},
    h('div', {}, h('strong', {}, b.label || `Version ${b.rev}`), h('br'), h('span', {}, `Saved ${timeAgo(b.savedAt)}${b.size ? ` · ${fmtBytes(b.size)}` : ''}`)),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: async () => {
      const lose = state.dirty ? ' Your unpublished changes will be discarded.' : '';
      if (!(await confirmBox('Restore this version?', `Your site will go back to “${b.label || `version ${b.rev}`}”. The current version stays in History, so you can undo this.${lose}`, 'Restore', 'btn-primary'))) return;
      try {
        const r = await api(`/backups/${encodeURIComponent(b.name)}/restore`, { method: 'POST' });
        state.content = r.content; state.rev = r.rev; state.dirty = false;
        updateStatus(); toast('Restored.'); route(true);
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Restore')))) : h('div.empty', {}, 'No earlier versions yet. Each publish keeps the previous version here.'));
  return [pageHead('History', 'The last 50 published versions. Restoring is itself undoable.'), box];
}

/* ============================================================ router */

async function route(keepScroll = false) {
  if (!state.content) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [section = '', a, b] = parts;
  drawNav(section);
  document.body.classList.remove('sb-open');
  let nodes;
  try {
    switch (section) {
      case '': nodes = dashboardView(); break;
      case 'projects':
        if (a === 'new') { location.replace('#/projects'); newProjectDialog(); return; }
        nodes = a ? projectView(a, b) : projectsView();
        break;
      case 'home': nodes = formView('Home page', 'The story visitors scroll through, top to bottom.', HOME, '/'); break;
      case 'about': nodes = formView('About', 'Your bio on the home page and the full About page.', ABOUT, '/about'); break;
      case 'method': nodes = formView('Method & services', 'How you work, told in three acts, and what you bring.', METHOD, '/#process'); break;
      case 'testimonials': nodes = formView('Testimonials', 'Short quotes from people you have worked with.', TESTIMONIALS, '/'); break;
      case 'site': nodes = formView('Site settings', 'Identity, contact details, colours and search appearance.', SITE, '/'); break;
      case 'media': nodes = await mediaView(); break;
      case 'history': nodes = await historyView(); break;
      default: nodes = [h('div.empty', {}, 'Page not found.')];
    }
  } catch (e) {
    nodes = [h('div.empty', {}, e.message)];
  }
  const view = $('#view');
  view.replaceChildren(...nodes);
  if (!keepScroll) { scrollTo(0, 0); view.focus({ preventScroll: true }); }
}

/* ============================================================ boot */

function showLogin() {
  $('#login').hidden = false;
  $('#app').hidden = true;
  setTimeout(() => $('#pw').focus(), 50);
}

async function boot() {
  const s = await api('/session').catch(() => ({ authed: false }));
  state.mode = s.mode || 'local';
  if (!s.authed) return showLogin();
  if (!state.content) {
    const c = await api('/content');
    state.content = c;
    state.rev = c._rev || 0;
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  updateStatus();
  route();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { password: $('#pw').value } });
    $('#pw').value = '';
    boot();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
});

$('#saveBtn').addEventListener('click', save);
$('#previewBtn').addEventListener('click', () => preview(currentPreviewPath));
$('#logoutBtn').addEventListener('click', async () => {
  if (state.dirty && !(await confirmBox('Sign out?', 'You have unpublished changes. They will be lost.', 'Sign out anyway'))) return;
  await api('/logout', { method: 'POST' }).catch(() => {});
  state.content = null; state.dirty = false;
  showLogin();
});
$('#sbToggle').addEventListener('click', () => document.body.classList.toggle('sb-open'));
addEventListener('hashchange', () => route());
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
});
addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
setInterval(() => { if (!state.dirty && !state.saving && state.content) updateStatus(); }, 30000);

boot();
