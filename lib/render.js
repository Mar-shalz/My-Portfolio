// Server-side renderer: turns the content document into complete HTML pages.
// All motion is layered on by /assets/site.js; every page reads fine without it.
import { esc, inline, md, plain, safeUrl, isExternal } from './text.js';

const ARROW = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_UR = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const APPEARANCE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 5v14h5a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" fill="currentColor"/></svg>';

const ARROW_L = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOWN = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOCUMENT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7l-4-4Zm0 0v5h4M9 12h6m-6 4h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const pad = (n) => String(n).padStart(2, '0');
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// Preserve the chosen hue while keeping small accent text readable in both themes.
function readableAccent(hex, background, lighten) {
  const parse = value => {
    let h = value.replace('#', '');
    if (h.length === 3) h = [...h].map(x => x + x).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  };
  const luminance = rgb => rgb.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
    .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
  let rgb = parse(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : '#9e351f');
  const bg = luminance(parse(background));
  for (let i = 0; i < 100; i++) {
    const fg = luminance(rgb);
    if ((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) >= 4.8) break;
    rgb = rgb.map(x => Math.round(lighten ? x + (255 - x) * .08 : x * .92));
  }
  return `#${rgb.map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

export function createRenderer({ sizeOf = () => null, assetVersion = '1', analytics = false } = {}) {
  const v = assetVersion;

  // ---------- small building blocks ----------
  const href = (ctx, p) => esc(`${ctx.base}${p}`);
  const linkAttrs = (url) => (isExternal(url) ? ' target="_blank" rel="noopener"' : '');

  function media(src, { alt = '', cls = '', eager = false } = {}) {
    const url = safeUrl(src);
    if (!url) return '';
    if (/\.(mp4|webm)([?#]|$)/i.test(url)) {
      return `<video class="${cls}" src="${esc(url)}" autoplay muted loop playsinline preload="metadata" aria-label="${esc(alt)}"></video>`;
    }
    const d = sizeOf(url);
    const dims = d ? ` width="${d.w}" height="${d.h}"` : '';
    const load = eager ? ' fetchpriority="high"' : ' loading="lazy"';
    return `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}"${dims}${load} decoding="async">`;
  }

  const eyebrow = (text, extra = '') =>
    text ? `<div class="eyebrow${extra}"><span class="eyebrow-bar"></span><span>${inline(text)}</span></div>` : '';

  function stats(list, cls = 'stats') {
    const items = (list || []).filter((s) => s && (s.value || s.label));
    if (!items.length) return '';
    return `<dl class="${cls}">${items
      .map((s) => `<div class="stat"><dt>${inline(s.label)}</dt><dd data-count>${esc(s.value)}</dd></div>`)
      .join('')}</dl>`;
  }

  // Keep a normal link as the fallback when modal previews are unavailable.
  function resume(site, cls, label, icon = '') {
    const url = safeUrl(site.resumeUrl);
    if (!url) return '';
    const preview = resumePreviewUrl(url);
    return `<a class="${cls}" href="${esc(url)}"${preview ? ` data-resume-preview data-resume-src="${esc(preview)}" aria-haspopup="dialog"` : ''}><span>${esc(label)}</span>${icon}</a>`;
  }

  const accentStyle = (hex) => (/^#[0-9a-f]{3,8}$/i.test(hex || '') ? ` style="--pc:${hex}"` : '');

  // ---------- layout ----------
  function layout(ctx, { title, description, image, bodyClass = '', main, path = '/', back = null }) {
    const { site } = ctx.c;
    const accent = /^#[0-9a-f]{3,8}$/i.test(site.accent || '') ? site.accent : '#EF5A28';
    const theme = ['light', 'dark', 'system'].includes(site.defaultTheme) ? site.defaultTheme : 'light';
    const siteUrl = String(site.siteUrl || '').replace(/\/+$/, '');
    const abs = (u) => (u && siteUrl && u.startsWith('/') ? siteUrl + u : u);
    const ogImage = abs(safeUrl(image || site.ogImage || ''));
    const socials = (site.socials || []).map((s) => safeUrl(s.url)).filter(Boolean);
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: site.name,
      jobTitle: site.role,
      address: { '@type': 'PostalAddress', addressLocality: site.location },
      ...(site.email ? { email: `mailto:${site.email}` } : {}),
      ...(siteUrl ? { url: siteUrl } : {}),
      ...(socials.length ? { sameAs: socials } : {}),
    };

    return `<!doctype html>
<html lang="en" class="no-js" data-theme-default="${theme}"${bodyClass === 'is-home' ? ' data-home' : ''}>
<head>
${ctx.preview ? '<base href="/">' : ''}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(plain(title))}</title>
<meta name="description" content="${esc(plain(description))}">
${siteUrl ? `<link rel="canonical" href="${esc(siteUrl + path)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(plain(title))}">
<meta property="og:description" content="${esc(plain(description))}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}"><meta name="twitter:card" content="summary_large_image">` : ''}
${ctx.preview ? '<meta name="robots" content="noindex">' : ''}
<meta name="theme-color" content="#0a0d13">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script>
(function(){var d=document.documentElement;d.className=d.className.replace('no-js','js');
var t=d.getAttribute('data-theme-default');try{t=localStorage.getItem('portfolio-appearance')||t}catch(e){}
if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.setAttribute('data-theme',t);
if(matchMedia('(prefers-reduced-motion: reduce)').matches)d.classList.add('no-motion');})();
</script>
<link rel="preload" href="/assets/fonts/Lufga-Regular.otf" as="font" type="font/otf" crossorigin>
<link rel="stylesheet" href="/assets/site.css?v=${v}">
<link rel="stylesheet" href="/assets/editorial.css?v=${v}">
<style>:root,[data-theme="light"]{--ac:${readableAccent(accent, '#e0ebe6', false)};--accent:var(--ac)}[data-theme="dark"]{--ac:${readableAccent(accent, '#202f34', true)};--accent:var(--ac)}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
${ctx.preview ? '<div class="preview-bar">Preview: unpublished draft. Close this preview to return to the portal.</div>' : ''}
<div class="progress" aria-hidden="true"><span></span></div>
${nav(ctx)}
${back ? `<a class="back back-float" href="${href(ctx, back.href)}"><span class="back-ic">${ARROW_L}</span><span>${esc(back.label)}</span></a>` : ''}
<main id="main">
${main}
</main>
${footer(ctx)}
${resumePreviewUrl(site.resumeUrl) ? `<dialog id="resume-dialog" class="resume-dialog" aria-labelledby="resume-title"><div class="resume-toolbar"><div><p class="eyebrow">${esc(site.name)}</p><h2 id="resume-title">Résumé</h2></div><a class="text-link" href="${esc(safeUrl(site.resumeUrl))}" target="_blank" rel="noopener">Open original${ARROW_UR}</a><button class="icon-btn" type="button" data-resume-close aria-label="Close résumé preview">×</button></div><iframe data-resume-frame title="${esc(site.name)} résumé preview" referrerpolicy="strict-origin-when-cross-origin"></iframe><p class="resume-note">${/\/folders\//.test(site.resumeUrl) ? 'Choose a résumé from the shared folder. ' : ''}If the preview is unavailable, use Open original.</p></dialog>` : ''}
<script src="/assets/site.js?v=${v}" defer></script>
${analytics && !ctx.preview ? '<script defer src="/_vercel/insights/script.js"></script>' : ''}
</body>
</html>`;
  }

  function nav(ctx) {
    const { site } = ctx.c;
    const links = [
      ['Work', '/#work'],
      ['Method', '/#process'],
      ['About', '/#about'],
      ['Contact', '/#contact'],
    ];
    const items = links.map(([t, p]) => `<a class="nav-link" href="${href(ctx, p)}" data-nav="${esc(p)}">${t}</a>`).join('');
    return `<header class="nav" data-nav-root>
  <a class="brand" href="${href(ctx, '/')}" aria-label="${esc(site.name)}, home">
    <span class="brand-mark">${esc(site.initial || (site.name || 'V')[0])}<i aria-hidden="true">.</i></span>
    <span class="brand-name">${esc(site.name)}<small>${esc(site.role)}</small></span>
  </a>
  <nav class="nav-links" aria-label="Primary">${items}</nav>
  <div class="nav-actions">
    ${resume(site, 'btn btn-ghost btn-sm nav-resume', 'Résumé', DOCUMENT)}
    <button class="icon-btn" type="button" data-theme-toggle aria-label="Toggle colour theme">${APPEARANCE}</button>
    <a class="btn btn-primary btn-sm magnetic" href="${href(ctx, '/#contact')}"><span>Let's talk</span>${ARROW_UR}</a>
    <button class="icon-btn menu-btn" type="button" data-menu-toggle aria-expanded="false" aria-controls="menu" aria-label="Open menu"><span></span><span></span></button>
  </div>
</header>
<div class="menu" id="menu" aria-hidden="true">
  <nav class="menu-links" aria-label="Mobile">${links
    .map(([t, p], i) => `<a class="menu-link" href="${href(ctx, p)}"><span class="menu-num">${pad(i + 1)}</span>${t}</a>`)
    .join('')}</nav>
  <div class="menu-foot">${site.email ? `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>` : ''}<span>${esc(site.location || '')}</span></div>
</div>`;
  }

  function footer(ctx) {
    const { site, projects } = ctx.c;
    const live = [];
    for (const p of projects.filter((x) => x.published)) {
      const l = (p.links || []).find((x) => /^https?:\/\//i.test(safeUrl(x.url)));
      if (l && live.length < 5) live.push([plain(p.title), l.url]);
    }
    const year = new Date().getFullYear();
    return `<footer class="footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="footer-name">${esc(site.name)}</div>
        <p>${esc(site.role || '')}${site.location ? ` · ${esc(site.location)}` : ''}</p>
        ${site.availability?.label ? `<span class="pill${site.availability.open === false ? ' is-off' : ''}"><span class="dot"></span>${esc(site.availability.label)}</span>` : ''}
      </div>
      <div class="footer-col"><h4>Navigate</h4>
        <a href="${href(ctx, '/#work')}">Work</a><a href="${href(ctx, '/#process')}">Method</a><a href="${href(ctx, '/about')}">About</a><a href="${href(ctx, '/#contact')}">Contact</a>
      </div>
      <div class="footer-col"><h4>Connect</h4>
        ${site.email ? `<a href="mailto:${esc(site.email)}">Email</a>` : ''}
        ${(site.socials || []).filter((s) => safeUrl(s.url)).map((s) => `<a href="${esc(safeUrl(s.url))}"${linkAttrs(s.url)}>${esc(s.label)}</a>`).join('')}
        ${resume(site, '', 'View résumé')}
      </div>
      ${live.length ? `<div class="footer-col"><h4>Live work</h4>${live.map(([t, u]) => `<a href="${esc(safeUrl(u))}"${linkAttrs(u)}>${esc(t)}</a>`).join('')}</div>` : ''}
    </div>
    <div class="footer-bottom"><span>© ${year} ${esc(site.name)}</span><span>${esc(site.footerNote || '')}</span></div>
  </div>
</footer>`;
  }

  // ---------- product illustrations and inspectable source images ----------
  const LOCK = '<svg viewBox="0 0 80 90" fill="none" aria-hidden="true"><rect x="12" y="36" width="56" height="44" rx="12" stroke="currentColor" stroke-width="2"/><path d="M24 36V24a16 16 0 0 1 32 0v12" stroke="currentColor" stroke-width="2"/><circle cx="40" cy="55" r="4" fill="currentColor"/><path d="M40 59v8" stroke="currentColor" stroke-width="2"/></svg>';
  const roleOf = p => (p.meta || []).find(m => /^role$/i.test(m.label))?.value || 'Product design';
  const projectName = p => plain(p.shortTitle || p.title);
  function projectArt(p, eager = false) {
    if (p.cover) return `<div class="product-art art-mobile${p.coverFit === 'contain' ? ' is-framed' : ''}"><span class="art-orbit orbit-one" aria-hidden="true"></span><span class="art-orbit orbit-two" aria-hidden="true"></span><div class="product-screen">${media(p.cover,{alt:plain(p.title),eager})}</div><span class="art-caption">${esc(p.client || '')} / ${esc(p.status || '')}</span></div>`;
    if (p.art === 'banking') return `<div class="product-art art-banking"><div class="bank-map"><div class="map-bar"><span class="map-dots" aria-hidden="true">● ● ●</span><span>Design coordination</span><span>↗</span></div><div class="map-lead"><span class="node-icon" aria-hidden="true">↗</span><div><small>MY ROLE</small><strong>Design lead</strong></div><span class="map-pulse" aria-hidden="true"></span></div><div class="map-connectors" aria-hidden="true"><i></i><i></i><i></i></div><div class="map-modules"><div><span>01</span><strong>Assign<br>modules</strong></div><div><span>02</span><strong>Review<br>the work</strong></div><div><span>03</span><strong>Align<br>the team</strong></div></div><div class="map-feedback"><span>↳</span> Team feedback & shared direction <span>↵</span></div></div><span class="art-caption">Illustrative coordination map · product screens pending</span></div>`;
    if (p.art !== 'token') return '';
    return `<div class="product-art art-token"><span class="security-orbit orbit-one" aria-hidden="true"></span><span class="security-orbit orbit-two" aria-hidden="true"></span><div class="token-system"><div class="token-entry"><span>Internet Banking</span><i aria-hidden="true">↓</i></div><div class="token-key">${LOCK}<strong>E-Token</strong><small>Authentication & authorization</small></div><div class="token-exits"><span>Sign in</span><span>Authorize transactions</span></div></div><span class="art-caption">Illustrative relationship · product screens pending</span></div>`;
  }
  function zoomMedia(src, alt, eager = false) {
    if (/\.(mp4|webm)([?#]|$)/i.test(src || '')) return media(src,{alt,eager});
    const url = safeUrl(src);
    return url ? `<button class="zoom-media" data-lightbox data-src="${esc(url)}" data-alt="${esc(alt)}" type="button" aria-label="Enlarge ${esc(alt || 'project image')}">${media(url,{alt,eager})}<span class="zoom-hint" aria-hidden="true">View larger ${ARROW_UR}</span></button>` : '';
  }

  // ---------- home: one continuous story, with a visible chapter index ----------
  function home(ctx) {
    const c = ctx.c;
    const { site, hero, about: a, work: w, process: pr } = c;
    const published = c.projects.filter(p => p.published);
    const studies = published.filter(p => p.kind === 'case-study');
    const featured = studies.filter(p => p.featured);
    const selected = featured.length ? featured : studies.slice(0, 3);
    const additional = studies.filter(p => !selected.includes(p));
    const cards = published.filter(p => p.kind === 'card');
    const heroHtml = `<section class="story-hero" data-hero><div class="wrap">
      <div class="hero-layout">
        <div class="hero-copy">
          ${eyebrow(hero.eyebrow)}
          <h1 class="hero-type">${(hero.lines || []).map(l => `<span>${inline(l)}</span>`).join('')}</h1>
          <div class="hero-lead rich">${md(hero.intro)}</div>
          <div class="hero-actions"><a class="btn btn-primary" data-magnetic href="${href(ctx, '/#work')}">${esc(hero.primaryCta || 'Explore my work')}${DOWN}</a><a class="text-link" href="${href(ctx, '/#about')}">${esc(hero.secondaryCta || 'The person behind the work')}${ARROW}</a></div>
          ${site.availability?.label ? `<p class="hero-availability"><span class="dot${site.availability.open === false ? ' is-off' : ''}"></span>${esc(site.availability.label)}</p>` : ''}
        </div>
        <div class="hero-portrait"${a.portraitMotion === false ? ' data-portrait-motion="off"' : ''}>${portrait(a, site)}<div class="portrait-note"><span>${esc(site.name)}</span><span>${esc(site.location)}</span></div></div>
      </div>
      <div class="proof-strip">${stats(hero.metrics, 'proof-stats')}${hero.proofNote ? `<p>${inline(hero.proofNote)}</p>` : ''}</div>
    </div></section>`;
    const work = `<section class="story-work" id="work"><div class="wrap">
      <header class="chapter-heading">${eyebrow(w.eyebrow)}<h2 class="display-title">${inline(w.title)}</h2><p>${inline(w.intro)}</p></header>
      <div class="story-layout"><nav class="story-index" aria-label="Project chapters"><span class="index-label">Follow the story</span>${selected.map((p,i) => `<a href="#story-${esc(p.id)}"${i === 0 ? ' aria-current="step"' : ''}><span>${pad(i+1)}</span><strong>${esc(projectName(p))}</strong>${ARROW}</a>`).join('')}${additional.length ? `<a class="index-more" href="#more-work">${esc(w.moreWorkCta || 'Commerce & web work')}${ARROW}</a>` : ''}<a class="index-method" href="#process">How I work ${DOWN}</a></nav>
      <div class="story-chapters">${selected.map((p,i) => {
        const nextHref = i < selected.length - 1 ? `#story-${selected[i+1].id}` : '#process';
        return `<article class="story-project story-${esc(p.art || 'mobile')}" id="story-${esc(p.id)}" aria-labelledby="story-title-${esc(p.id)}">
          <div class="story-kicker"><span>${pad(i+1)} / ${esc(projectName(p))}</span><span class="project-status">${esc(p.status)}</span></div>
          <h3 id="story-title-${esc(p.id)}">${inline(p.storyTitle || plain(p.title))}</h3>
          <p class="story-context">${inline(p.storyContext || p.hook)}</p>
          <a class="story-visual story-cover-link" href="${href(ctx, `/work/${p.slug}`)}" aria-label="${esc(p.storyCta || w.projectCta || 'Read case study')}: ${esc(projectName(p))}" data-reveal>${p.cover ? media(p.cover, {alt: `${plain(p.title)} · product screens`, eager:i===0}) : projectArt(p)}<span class="story-cover-cta" aria-hidden="true"><span>${esc(p.storyCta || w.projectCta || 'Read case study')}</span>${ARROW_UR}</span></a>
          <div class="story-evidence"><div><h4>My contribution</h4><p>${inline(p.storyContribution || roleOf(p))}</p></div><div><h4>Where it stands</h4><p>${inline(p.storyOutcome || p.glance?.impact || p.status)}</p></div></div>
          ${p.storyNext ? `<a class="story-bridge" href="${esc(nextHref)}"><span>${inline(p.storyNext)}</span>${DOWN}</a>` : ''}
        </article>`;
      }).join('')}</div></div>
      ${additional.length ? `<div class="supporting-work" id="more-work"><header>${eyebrow(w.otherEyebrow)}<h2 class="display-title">${inline(w.otherTitle)}</h2>${w.otherIntro ? `<p>${inline(w.otherIntro)}</p>` : ''}</header><div class="supporting-grid">${additional.map(p => `<a class="supporting-project" href="${href(ctx, `/work/${p.slug}`)}"><div class="supporting-image${p.coverFit === 'contain' ? ' is-framed' : ''}">${media(p.cover, { alt: plain(p.title) })}</div><span class="supporting-category">${esc(p.category)}</span><h3>${inline(p.title)}${ARROW_UR}</h3><p>${inline(p.hook)}</p></a>`).join('')}</div></div>` : ''}
    </div></section>`;
    const process = (pr.steps || []).length ? `<section class="story-method" id="process"><div class="wrap method-layout"><header class="chapter-heading">${eyebrow(pr.eyebrow)}<h2 class="display-title">${inline(pr.title)}</h2><p>${inline(pr.intro)}</p></header><div class="method-list">${pr.steps.map((s,i) => `<details class="method-item"${i === 0 ? ' open' : ''}><summary><span>${esc(s.label || pad(i+1))}</span><h3>${inline(s.title)}</h3><i aria-hidden="true">+</i></summary><div class="method-answer"><p>${inline(s.body)}</p><div class="method-chips">${(s.chips || []).map(t => `<span>${esc(t)}</span>`).join('')}</div></div></details>`).join('')}</div></div></section>` : '';
    const about = `<section class="story-about about-tone-${a.homeTone === 'sage' ? 'sage' : 'ink'}" id="about"><div class="wrap"><div class="about-story-layout"><div>${eyebrow(a.eyebrow)}<h2 class="display-title">${inline(a.title)}</h2>${a.principle ? `<p class="about-principle">${inline(a.principle)}</p>` : ''}</div><div><div class="about-narrative rich">${md(a.preview)}</div><a class="text-link" href="${href(ctx, '/about')}">More about ${esc(site.name.split(' ')[0])}${ARROW_UR}</a>${resume(site, 'text-link', hero.resumeCta || 'View résumé', DOWN)}</div></div>
      ${(a.experience || []).length ? `<div class="career-list" aria-label="Experience">${a.experience.map(x => `<div class="career-row"><span>${esc(x.period)}</span><h3>${esc(x.role)}</h3><p>${esc(x.company)}</p><small>${esc(x.location)}</small></div>`).join('')}</div>` : ''}
    </div></section>`;
    const others = cards.length ? `<section class="story-explorations" id="explorations"><div class="wrap"><header class="chapter-heading"><h2 class="display-title">${inline(w.explorationsTitle || 'Beyond banking.')}</h2>${w.explorationsIntro ? `<p>${inline(w.explorationsIntro)}</p>` : ''}</header><div class="studio-list">${cards.map((p,i) => {const link = (p.links || []).find(l => safeUrl(l.url));return `<details class="studio-item"><summary><span class="studio-index">${pad(i+1)}</span><h3>${inline(p.title)}</h3><span class="studio-status">${esc(p.status)}</span><span aria-hidden="true">+</span></summary><div class="studio-detail"><p>${inline(p.summary || p.hook)}</p>${link ? `<a class="text-link" href="${esc(safeUrl(link.url))}"${linkAttrs(link.url)}>${esc(link.label)}${ARROW_UR}</a>` : ''}</div></details>`}).join('')}</div></div></section>` : '';
    const quotes = (c.testimonials.items || []).filter(q => q.quote && q.published !== false);
    const requestCard = c.testimonials.showRequestCard !== false && site.email ? `<div class="testimonial-invite"><span class="invite-mark" aria-hidden="true">“</span><div><h3>${inline(c.testimonials.requestTitle || 'Worked with me?')}</h3><p>${inline(c.testimonials.requestText)}</p><a class="text-link" href="mailto:${esc(site.email)}?subject=${encodeURIComponent('A testimonial for ' + site.name)}">${esc(c.testimonials.requestCta || 'Share a testimonial')}${ARROW_UR}</a></div></div>` : '';
    const testimonials = c.testimonials.show !== false && (quotes.length || requestCard) ? `<section class="testimonials" id="testimonials"><div class="wrap"><header>${eyebrow(c.testimonials.eyebrow)}<h2 class="display-title">${inline(c.testimonials.title)}</h2></header>${quotes.length ? `<div class="testimonial-carousel" data-testimonial-carousel data-autoplay="${c.testimonials.autoplay !== false}" role="region" aria-label="Recommendations" aria-roledescription="carousel"><div class="quote-grid testimonial-slides">${quotes.map((q,i) => `<figure class="tq" data-testimonial-slide role="group" aria-roledescription="slide" aria-label="${i+1} of ${quotes.length}"><span class="tq-mark" aria-hidden="true">“</span><blockquote>${inline(q.quote)}</blockquote><figcaption>${q.avatar ? media(q.avatar, {alt:q.name,cls:'tq-avatar'}) : ''}<span><strong>${esc(q.name)}</strong><span>${esc(q.role)}</span>${safeUrl(q.link) ? `<a href="${esc(safeUrl(q.link))}"${linkAttrs(q.link)}>View source ↗</a>` : ''}</span></figcaption></figure>`).join('')}</div><div class="carousel-controls" data-carousel-controls hidden><button class="icon-btn" type="button" data-carousel-prev aria-label="Previous testimonial">${ARROW_L}</button><span data-carousel-status aria-live="off">1 / ${quotes.length}</span><button class="icon-btn" type="button" data-carousel-next aria-label="Next testimonial">${ARROW}</button><button class="carousel-toggle" type="button" data-carousel-toggle>Pause rotation</button></div></div>` : ''}${requestCard}</div></section>` : '';
    return layout(ctx, {title:site.seoTitle, description:site.seoDescription, bodyClass:'is-home', main:[heroHtml,work,process,about,others,testimonials,contact(ctx)].join('\n'), path:'/'});
  }

  function portrait(a, site) {
    if (safeUrl(a.portrait)) return `<figure class="portrait">${media(a.portrait, { alt: `Portrait of ${site.name}`, eager:true })}</figure>`;
    return `<figure class="portrait portrait-placeholder" aria-label="Portrait space for ${esc(site.name)}"><span class="portrait-label">The person behind the work</span><span class="portrait-initials" aria-hidden="true">${esc((site.name || 'Victor Ajibodu').split(' ').map(n => n[0]).slice(0,2).join(''))}<i>↗</i></span><figcaption>Portrait to be added</figcaption></figure>`;
  }

  function contact(ctx) {
    const { site, contact: ct } = ctx.c;
    const socials = (site.socials || []).filter((s) => safeUrl(s.url));
    return `<section class="contact" id="contact">
  <div class="wrap">
    ${eyebrow(ct.eyebrow)}
    <h2 class="contact-title" data-split>${inline(ct.title || '')}</h2>
    ${ct.body ? `<p class="contact-body" data-reveal>${inline(ct.body)}</p>` : ''}
    <div class="contact-actions" data-reveal>
      ${site.email ? `<a class="btn btn-primary btn-xl" data-magnetic href="mailto:${esc(site.email)}"><span>${esc(ct.cta || 'Email me')}</span>${ARROW}</a>
      <button class="btn btn-ghost btn-xl" type="button" data-copy="${esc(site.email)}"><span data-copy-label aria-live="polite">Copy email</span></button>` : ''}
      ${safeUrl(site.bookingUrl) ? `<a class="btn btn-ghost btn-xl" href="${esc(safeUrl(site.bookingUrl))}"${linkAttrs(site.bookingUrl)}><span>${esc(site.bookingLabel || 'Book a 20-min call')}</span>${ARROW_UR}</a>` : ''}
      ${resume(site, 'btn btn-ghost btn-xl', 'View résumé', DOWN)}
    </div>
    <div class="contact-meta" data-reveal>
      ${site.email ? `<div><span>Email</span><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></div>` : ''}
      ${site.phone && site.showPhone !== false ? `<div><span>Phone</span><a href="tel:${esc(site.phone.replace(/[^\d+]/g, ''))}">${esc(site.phone)}</a></div>` : ''}
      <div><span>Local time · ${esc((site.location || '').split(',')[0])}</span><strong data-clock="${esc(site.timezone || 'Africa/Lagos')}">--:--</strong>${site.timezoneNote ? `<small class="tz-note">${esc(site.timezoneNote)}</small>` : ''}</div>
      ${socials.length ? `<div><span>Elsewhere</span><p>${socials.map((s) => `<a href="${esc(safeUrl(s.url))}"${linkAttrs(s.url)}>${esc(s.label)} ↗</a>`).join('')}</p></div>` : ''}
    </div>
  </div>

</section>`;
  }

  // ---------- case study ----------
  function caseStudy(ctx, p) {
    const c = ctx.c;
    const studies = c.projects.filter((x) => x.published && x.kind === 'case-study');
    const idx = studies.findIndex((x) => x.id === p.id);
    const next = studies.length > 1 ? studies[(idx + 1) % studies.length] : null;
    const blocks = p.blocks || [];

    const chapters = [];
    const body = blocks
      .map((b, i) => {
        const id = `ch-${i + 1}`;
        if (b.eyebrow) chapters.push({ id, label: plain(b.eyebrow) });
        return renderBlock(b, id);
      })
      .join('\n');

    const g = p.glance || {};
    const glance = g.problem || g.solution || g.impact
      ? `<section class="glance wrap" aria-label="At a glance">
    <div class="glance-head">${eyebrow('At a glance')}${p.summary ? `<p class="glance-sum" data-reveal>${inline(p.summary)}</p>` : ''}</div>
    <div class="glance-grid">
      ${[['The problem', g.problem], ['What I did', g.solution], ['The impact', g.impact]]
        .filter(([, t]) => t)
        .map(([l, t], i) => `<div class="glance-card" data-reveal><span class="glance-n">${pad(i + 1)}</span><h3>${l}</h3><p>${inline(t)}</p></div>`)
        .join('')}
    </div>
  </section>`
      : '';

    const links = (p.links || []).filter((l) => safeUrl(l.url));
    const main = `<article class="cs"${accentStyle(p.accent)}>
  <section class="cs-hero">
    <div class="wrap">
      <a class="back" href="${href(ctx, '/#work')}"><span class="back-ic">${ARROW_L}</span><span>All work</span></a>
      <div class="cs-head">
        <div class="cs-head-main">
        <div class="cs-tags" data-hero-item>${p.status ? `<span class="tag tag-strong">${esc(p.status)}</span>` : ''}${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${p.year ? `<span class="tag">${esc(p.year)}</span>` : ''}</div>
        <h1 class="cs-title">${lines(p.title)}</h1>
        ${p.hook ? `<p class="cs-hook" data-hero-item>${inline(p.hook)}</p>` : ''}
        </div>
        ${links.length ? `<div class="cs-links" data-hero-item>${links.map((l, i) => `<a class="btn ${i === 0 ? 'btn-live' : 'btn-ghost'} btn-sm magnetic" href="${esc(safeUrl(l.url))}"${linkAttrs(l.url)}><span>${esc(l.label)}</span>${ARROW_UR}</a>`).join('')}</div>` : ''}
      </div>
      ${(p.meta || []).length ? `<dl class="cs-meta" data-hero-item>${p.meta.map((m) => `<div><dt>${esc(m.label)}</dt><dd>${inline(m.value)}</dd></div>`).join('')}</dl>` : ''}
      ${(p.tools || []).length ? `<div class="cs-tools" data-hero-item><span>Tools</span><ul class="chips">${p.tools.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    </div>
    ${p.heroImage || p.cover ? `<div class="wrap"><figure class="cs-hero-media" data-clip data-hero-media>${zoomMedia(p.heroImage || p.cover, plain(p.title), true)}</figure></div>` : p.art ? `<div class="wrap cs-art-wrap">${projectArt(p)}</div>` : ''}
  </section>
  ${glance}
  <div class="cs-layout wrap">
    ${chapters.length > 1 ? `<aside class="toc" aria-label="Chapters"><div class="toc-inner"><div class="toc-title">Chapters</div><ol>${chapters.map((ch, i) => `<li><a href="#${ch.id}" data-toc="${ch.id}"><span>${pad(i + 1)}</span>${esc(ch.label)}</a></li>`).join('')}</ol><div class="toc-progress"><span></span></div></div></aside>` : ''}
    <div class="cs-content" data-cs-content>${body}</div>
  </div>
  ${next ? nextProject(ctx, next) : ''}
</article>
${contact(ctx)}`;

    return layout(ctx, {
      title: `${plain(p.title)} | ${c.site.name}`,
      description: p.hook || p.summary || '',
      image: p.cover,
      bodyClass: 'is-case',
      back: { href: '/#work', label: 'All work' },
      main,
      path: `/work/${p.slug}`,
    });
  }

  const lines = (title) => `<span class="line"><span class="line-in">${inline(title || '')}</span></span>`;

  function nextProject(ctx, n) {
    return `<section class="next"${accentStyle(n.accent)}>
  <a class="next-link wrap" href="${href(ctx, `/work/${n.slug}`)}" data-cursor="Next story">
    <span class="next-eyebrow">Next story</span>
    <span class="next-title">${inline(n.title)}</span>
    <span class="next-hook">${inline(n.hook || '')}</span>
    ${n.cover ? `<span class="next-img">${media(n.cover, { alt: '' })}</span>` : ''}
    <span class="next-arrow">${ARROW}</span>
  </a>
</section>`;
  }

  function renderBlock(b, id) {
    const head =
      b.eyebrow || b.heading || b.body
        ? `<header class="blk-head">
      ${eyebrow(b.eyebrow)}
      ${b.heading ? `<h2 class="blk-title" data-split>${inline(b.heading)}</h2>` : ''}
      ${b.body ? `<div class="rich" data-reveal>${md(b.body)}</div>` : ''}
    </header>`
        : '';
    const wrap = (inner, extra = '') =>
      `<section class="blk blk-${esc(b.type)}${extra}"${b.eyebrow ? ` id="${id}" data-chapter` : ''}>${head}${inner}</section>`;

    switch (b.type) {
      case 'text':
        return wrap('');
      case 'image': {
        if (!b.src) return wrap('');
        return wrap(`<figure class="figure" data-clip>${zoomMedia(b.src, plain(b.caption || b.heading || ''))}${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`, b.wide ? ' is-wide' : '');
      }
      case 'gallery':
        return wrap(`<div class="gallery">${(b.images || []).filter((x) => x.src).map((x) => `<figure class="gallery-item" data-reveal>${zoomMedia(x.src, plain(x.label || ''))}${x.label ? `<figcaption>${esc(x.label)}</figcaption>` : ''}</figure>`).join('')}</div>`);
      case 'quote':
        return wrap(`<figure class="pull" data-reveal><blockquote>“${inline(b.text || '')}”</blockquote>${b.attribution ? `<figcaption>${inline(b.attribution)}</figcaption>` : ''}</figure>`);
      case 'kpis':
        return wrap(stats(b.items, 'kpis') + (b.note ? `<p class="kpi-note" data-reveal><span>How this was measured</span>${inline(b.note)}</p>` : ''));
      case 'cards': {
        const cols = Number(b.columns) === 2 ? 2 : 3;
        const style = ['problem', 'solution', 'neutral', 'learning'].includes(b.style) ? b.style : 'neutral';
        return wrap(`<div class="cards cards-${cols} cards-${style}">${(b.items || []).map((x) => `<div class="card" data-reveal>${x.label ? `<div class="card-label">${inline(x.label)}</div>` : ''}<div class="card-body">${md(x.body || '')}</div></div>`).join('')}</div>`);
      }
      case 'callout':
        return wrap(b.text || b.label ? `<div class="callout" data-reveal>${b.label ? `<div class="callout-label">${inline(b.label)}</div>` : ''}<div class="rich">${md(b.text || '')}</div></div>` : '');
      case 'steps':
        return wrap(`<ol class="steps">${(b.items || []).map((x, i) => `<li class="step" data-reveal><span class="step-n">${pad(i + 1)}</span><h3>${inline(x.title || '')}</h3><p>${inline(x.body || '')}</p></li>`).join('')}</ol>`);
      case 'palette': {
        const colors = (b.colors || []).filter((x) => /^#[0-9a-f]{3,8}$/i.test(x.hex || ''));
        const specs = (b.specs || []).filter((x) => x.label || x.value);
        return wrap(`<div class="palette" data-reveal>${colors.length ? `<div class="swatches">${colors.map((x) => `<div class="swatch"><span class="swatch-c" style="background:${x.hex}"></span><strong>${esc(x.hex.toUpperCase())}</strong><span>${esc(x.name || '')}</span></div>`).join('')}</div>` : ''}${specs.length ? `<dl class="specs">${specs.map((x) => `<div><dt>${esc(x.label)}</dt><dd>${inline(x.value)}</dd></div>`).join('')}</dl>` : ''}</div>`);
      }
      case 'embed': {
        const src = embedUrl(b.url);
        if (!src) return wrap('');
        const ratio = { '16:9': '16 / 9', '4:3': '4 / 3', '1:1': '1 / 1', '9:16': '9 / 16' }[b.ratio] || '16 / 9';
        return wrap(`<figure class="embed" data-reveal><div class="embed-frame" style="aspect-ratio:${ratio}"><iframe src="${esc(src)}" loading="lazy" allowfullscreen title="${esc(plain(b.caption || b.heading || 'Embedded prototype'))}"></iframe></div>${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`);
      }
      default:
        return wrap('');
    }
  }

  // ---------- about ----------
  function about(ctx) {
    const { site, about: a } = ctx.c;
    const main = `<section class="about-page">
  <div class="wrap">
    <div class="about-hero">
      <a class="back" href="${href(ctx, '/#about')}"><span class="back-ic">${ARROW_L}</span><span>Back to home</span></a>
      ${eyebrow('About')}
      <h1 class="about-title">${lines(a.pageTitle || a.title)}</h1>
      ${a.pageLead ? `<p class="about-lead" data-hero-item>${inline(a.pageLead)}</p>` : ''}
    </div>
    <div class="about-layout">
      <div class="about-main">
        <div class="about-portrait-wrap">${portrait(a, site)}</div>
        <div class="rich rich-lg" data-reveal>${md(a.body)}</div>
        <div class="about-ctas" data-reveal>
          ${site.email ? `<a class="btn btn-primary magnetic" href="mailto:${esc(site.email)}"><span>Email me</span>${ARROW}</a>` : ''}
          ${resume(site, 'btn btn-ghost', 'View résumé', DOWN)}
          ${(site.socials || []).filter((s) => safeUrl(s.url)).map((s) => `<a class="btn btn-ghost" href="${esc(safeUrl(s.url))}"${linkAttrs(s.url)}><span>${esc(s.label)}</span>${ARROW_UR}</a>`).join('')}
        </div>
      </div>
      <aside class="about-aside">
        ${(a.now || []).length ? `<div class="aside-block" data-reveal><h2>Right now</h2>${a.now.map((n) => `<div class="now-row"><span>${esc(n.label)}</span><p>${inline(n.text)}</p></div>`).join('')}</div>` : ''}
        ${(a.experience || []).length ? `<div class="aside-block" data-reveal><h2>Experience</h2>${a.experience.map((x) => `<div class="exp"><strong>${esc(x.role)}</strong><span>${esc(x.company)}</span><small>${esc([x.period, x.location].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>` : ''}
        ${(a.capabilities || []).length ? `<div class="aside-block" data-reveal><h2>Capabilities</h2><ul class="chips">${a.capabilities.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${(a.tools || []).some((g) => (g.items || []).length) ? `<div class="aside-block" data-reveal><h2>Toolkit</h2>${a.tools.filter((g) => (g.items || []).length).map((g) => `<div class="tool-group">${g.group ? `<span>${esc(g.group)}</span>` : ''}<ul class="chips">${g.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>` : ''}
        ${(a.domains || []).length ? `<div class="aside-block" data-reveal><h2>Domains</h2><ul class="chips">${a.domains.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </aside>
    </div>
    ${(a.stats || []).length ? `<div class="about-stats">${a.stats.map((s) => `<div class="about-stat" data-reveal><div class="about-stat-n" data-count>${esc(s.value)}</div><p>${inline(s.label)}</p></div>`).join('')}</div>` : ''}
  </div>
</section>
${contact(ctx)}`;
    return layout(ctx, {
      title: `About | ${site.name}`,
      description: plain(a.pageLead || a.preview || site.seoDescription || ''),
      image: a.portrait,
      bodyClass: 'is-about',
      back: { href: '/#about', label: 'Back to home' },
      main,
      path: '/about',
    });
  }

  function notFound(ctx) {
    const main = `<section class="nf"><div class="wrap">
  ${eyebrow('404')}
  <h1 class="nf-title">${lines('This chapter *doesn\'t exist.*')}</h1>
  <p class="nf-body" data-hero-item>The page may have moved, or the link is out of date.</p>
  <a class="btn btn-primary magnetic" href="${href(ctx, '/')}" data-hero-item><span>Back to the story</span>${ARROW}</a>
</div></section>`;
    return layout(ctx, { title: `Not found | ${ctx.c.site.name}`, description: '', bodyClass: 'is-404', main, path: '/404' });
  }

  return { home, caseStudy, about, notFound };
}

// Drive has separate embeddable routes; ordinary folder links refuse framing.
export function resumePreviewUrl(value = '') {
  const source = safeUrl(value);
  if (/^\/uploads\/[^?#]+\.pdf(?:[?#]|$)/i.test(source)) return source;
  let url;
  try { url = new URL(source); } catch { return ''; }
  if (url.protocol !== 'https:') return '';
  if (url.hostname === 'drive.google.com') {
    const file = /^\/file\/d\/([\w-]+)/.exec(url.pathname);
    if (file) return `https://drive.google.com/file/d/${file[1]}/preview`;
    const folder = /^\/(?:drive\/)?folders\/([\w-]+)/.exec(url.pathname);
    if (folder) return `https://drive.google.com/embeddedfolderview?id=${folder[1]}#list`;
  }
  return /\.pdf$/i.test(url.pathname) ? url.href : '';
}

// Only allow embeds from well-known prototype/video hosts.
export function embedUrl(u) {
  let url;
  try { url = new URL(String(u || '')); } catch { return ''; }
  if (url.protocol !== 'https:') return '';
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'figma.com' || host.endsWith('.figma.com')) {
    if (url.pathname.startsWith('/embed')) return url.href;
    return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url.href)}`;
  }
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/').pop();
    return /^[\w-]{6,}$/.test(id || '') ? `https://www.youtube-nocookie.com/embed/${id}` : '';
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).pop();
    return /^\d+$/.test(id || '') ? `https://player.vimeo.com/video/${id}` : '';
  }
  if (host === 'loom.com') {
    const id = url.pathname.split('/').filter(Boolean).pop();
    return /^[\w-]+$/.test(id || '') ? `https://www.loom.com/embed/${id}` : '';
  }
  return '';
}
