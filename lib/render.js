// Server-side renderer: turns the content document into complete HTML pages.
// All motion is layered on by /assets/site.js; every page reads fine without it.
import { esc, inline, md, plain, safeUrl, isExternal } from './text.js';

const ARROW = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_UR = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SUN = '<svg class="ic ic-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const MOON = '<svg class="ic ic-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const ARROW_L = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOWN = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const pad = (n) => String(n).padStart(2, '0');
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function createRenderer({ sizeOf = () => null, assetVersion = '1' } = {}) {
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

  // Résumé link: downloads the uploaded PDF. Renders nothing until one is uploaded.
  function resume(site, cls, label, icon = '') {
    const url = safeUrl(site.resumeUrl);
    if (!url) return '';
    const file = `${String(site.name || 'resume').replace(/[^\w]+/g, '-')}-Resume.pdf`;
    return `<a class="${cls}" href="${esc(url)}" download="${esc(file)}"><span>${esc(label)}</span>${icon}</a>`;
  }

  const accentStyle = (hex) => (/^#[0-9a-f]{3,8}$/i.test(hex || '') ? ` style="--pc:${hex}"` : '');

  // ---------- layout ----------
  function layout(ctx, { title, description, image, bodyClass = '', main, path = '/', back = null }) {
    const { site } = ctx.c;
    const accent = /^#[0-9a-f]{3,8}$/i.test(site.accent || '') ? site.accent : '#EF5A28';
    const theme = ['light', 'dark', 'system'].includes(site.defaultTheme) ? site.defaultTheme : 'system';
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
<meta name="theme-color" content="#0A1226">
<script>
(function(){var d=document.documentElement;d.className=d.className.replace('no-js','js');
var t=d.getAttribute('data-theme-default');try{t=localStorage.getItem('theme')||t}catch(e){}
if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.setAttribute('data-theme',t);
try{var ss=sessionStorage;if(ss.getItem('pt')==='1'){d.classList.add('pt-enter');ss.removeItem('pt')}
else if(d.hasAttribute('data-home')&&!ss.getItem('seen')&&!location.hash){d.classList.add('pt-enter','intro')}ss.setItem('seen','1')}catch(e){}
if(matchMedia('(prefers-reduced-motion: reduce)').matches)d.classList.add('no-motion');
setTimeout(function(){if(!d.classList.contains('motion-ready'))d.classList.add('no-motion')},4000)})();
</script>
<link rel="preconnect" href="https://api.fontshare.com">
<link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=lufga@300,400,500,600,700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/assets/site.css?v=${v}">
<style>:root{--ac:${accent}}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
${ctx.preview ? '<div class="preview-bar">Preview: unsaved draft. Close this tab to return to the portal.</div>' : ''}
<div class="curtain" aria-hidden="true"><span class="curtain-mark">${esc(site.initial || (site.name || 'V')[0])}</span><span class="curtain-name">${esc(site.name)}</span><span class="curtain-count">0</span></div>
<div class="progress" aria-hidden="true"><span></span></div>
<div class="cursor" aria-hidden="true"><span class="cursor-label"></span></div>
${nav(ctx)}
${back ? `<a class="back back-float" href="${href(ctx, back.href)}"><span class="back-ic">${ARROW_L}</span><span>${esc(back.label)}</span></a>` : ''}
<main id="main">
${main}
</main>
${footer(ctx)}
<script src="/vendor/gsap.min.js?v=${v}" defer></script>
<script src="/vendor/ScrollTrigger.min.js?v=${v}" defer></script>
<script src="/vendor/SplitText.min.js?v=${v}" defer></script>
<script src="/vendor/lenis.min.js?v=${v}" defer></script>
<script src="/assets/site.js?v=${v}" defer></script>
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
    <span class="brand-mark">${esc(site.initial || (site.name || 'V')[0])}</span>
    <span class="brand-name">${esc(site.name)}</span>
  </a>
  <nav class="nav-links" aria-label="Primary">${items}</nav>
  <div class="nav-actions">
    ${resume(site, 'btn btn-ghost btn-sm nav-resume', 'Résumé')}
    <button class="icon-btn" type="button" data-theme-toggle aria-label="Toggle colour theme">${SUN}${MOON}</button>
    <a class="btn btn-primary btn-sm magnetic" href="${href(ctx, '/#contact')}"><span>Let's talk</span></a>
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
      const l = (p.links || []).find((x) => safeUrl(x.url));
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
        ${resume(site, '', 'Résumé (PDF)')}
      </div>
      ${live.length ? `<div class="footer-col"><h4>Live work</h4>${live.map(([t, u]) => `<a href="${esc(safeUrl(u))}"${linkAttrs(u)}>${esc(t)}</a>`).join('')}</div>` : ''}
    </div>
    <div class="footer-bottom"><span>© ${year} ${esc(site.name)}</span><span>${esc(site.footerNote || '')}</span></div>
  </div>
</footer>`;
  }

  // ---------- home ----------
  function home(ctx) {
    const c = ctx.c;
    const { site, hero } = c;
    const published = c.projects.filter((p) => p.published);
    const studies = published.filter((p) => p.kind === 'case-study');
    const cards = published.filter((p) => p.kind === 'card');
    const open = site.availability?.open !== false;

    const heroHtml = `<section class="hero" data-hero>
  <div class="hero-bg" aria-hidden="true"><div class="hero-dots"></div><div class="hero-glow"></div></div>
  <div class="wrap hero-inner">
    ${site.availability?.label ? `<div data-hero-item><span class="avail${open ? '' : ' is-off'}"><span class="dot"></span>${esc(site.availability.label)}</span></div>` : ''}
    <h1 class="hero-title">${(hero.lines || []).map((l) => `<span class="line"><span class="line-in">${inline(l)}</span></span>`).join('')}</h1>
    <div class="hero-intro" data-hero-item>${md(hero.intro)}</div>
    <div class="hero-ctas" data-hero-item>
      <a class="btn btn-primary magnetic" href="${href(ctx, '/#work')}"><span>${esc(hero.primaryCta || 'See the work')}</span>${ARROW}</a>
      ${resume(site, 'btn btn-ghost magnetic', hero.resumeCta || 'Download résumé', DOWN)}
      <a class="btn btn-ghost magnetic" href="${href(ctx, '/#contact')}"><span>${esc(hero.secondaryCta || 'Get in touch')}</span></a>
    </div>
    <div class="hero-metrics-wrap" data-hero-item>${stats(hero.metrics, 'hero-metrics')}</div>
  </div>
</section>`;

    const manifesto = c.manifesto?.text
      ? `<section class="manifesto" id="story" data-manifesto>
  <div class="wrap">
    ${eyebrow(c.manifesto.eyebrow)}
    <p class="manifesto-text" data-words>${inline(c.manifesto.text)}</p>
  </div>
</section>`
      : '';

    const marquee = c.marquee?.length
      ? `<div class="marquee" aria-hidden="true" data-marquee><div class="marquee-track">${[0, 1]
          .map(() => `<div class="marquee-group">${c.marquee.map((m) => `<span>${esc(m)}</span><i>✦</i>`).join('')}</div>`)
          .join('')}</div></div>`
      : '';

    const stack = studies
      .map((p, i) => {
        const url = href(ctx, `/work/${p.slug}`);
        return `<article class="stack-card" data-stack-card${accentStyle(p.accent)}>
  <a class="stack-inner" href="${url}" data-cursor="Read the story">
    <div class="stack-body">
      <div class="stack-top"><span class="stack-idx">${pad(i + 1)} / ${pad(studies.length)}</span><span class="stack-cat">${esc(p.category || '')}</span></div>
      <h3 class="stack-title">${inline(p.title)}</h3>
      <p class="stack-hook">${inline(p.hook || '')}</p>
      ${stats(p.stats, 'stack-stats')}
      <span class="stack-cta">Read the case study ${ARROW}</span>
    </div>
    <div class="stack-media${p.coverFit === 'fill' ? ' is-fill' : ''}">
      <div class="stack-tags">${p.status ? `<span class="tag tag-strong">${esc(p.status)}</span>` : ''}${(p.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="stack-img" data-parallax>${media(p.cover, { alt: plain(p.title) })}</div>
    </div>
    <span class="stack-shade" aria-hidden="true"></span>
  </a>
</article>`;
      })
      .join('');

    const others = cards.length
      ? `<section class="more" id="more-work">
  <div class="wrap">
  <header class="sec-head">
    ${eyebrow(c.work.otherEyebrow)}
    <h2 class="sec-title" data-split>${inline(c.work.otherTitle || '')}</h2>
    ${c.work.otherIntro ? `<p class="sec-intro" data-reveal>${inline(c.work.otherIntro)}</p>` : ''}
  </header>
  <div class="other-grid">${cards
    .map((p) => {
      const link = (p.links || []).find((l) => safeUrl(l.url));
      const tag = link ? 'a' : 'article';
      const attrs = link ? ` href="${esc(safeUrl(link.url))}"${linkAttrs(link.url)} data-cursor="${esc(link.label || 'Open')}"` : '';
      return `<${tag} class="other-card tilt" data-reveal${attrs}${accentStyle(p.accent)}>
      ${p.cover ? `<div class="other-img">${media(p.cover, { alt: plain(p.title) })}</div>` : '<div class="other-glow" aria-hidden="true"></div>'}
      <div class="other-top"><span class="other-cat">${esc(p.category || '')}</span>${p.status ? `<span class="tag tag-status">${esc(p.status)}</span>` : ''}</div>
      <h4 class="other-title">${inline(p.title)}</h4>
      ${p.hook ? `<p class="other-hook">${inline(p.hook)}</p>` : ''}
      ${p.summary ? `<p class="other-sum">${inline(p.summary)}</p>` : ''}
      ${stats(p.stats, 'other-stats')}
    </${tag}>`;
    })
    .join('')}</div>
  </div>
</section>`
      : '';

    const work = `<section class="work" id="work">
  <div class="wrap">
    <header class="sec-head">
      ${eyebrow(c.work.eyebrow)}
      <h2 class="sec-title" data-split>${inline(c.work.title || '')}</h2>
      ${c.work.intro ? `<p class="sec-intro" data-reveal>${inline(c.work.intro)}</p>` : ''}
    </header>
    <div class="stack">${stack}</div>
  </div>
</section>`;

    const steps = c.process.steps || [];
    const process = steps.length
      ? `<section class="process" id="process">
  <div class="wrap">
    <header class="sec-head">
      ${eyebrow(c.process.eyebrow)}
      <h2 class="sec-title" data-split>${inline(c.process.title || '')}</h2>
      ${c.process.intro ? `<p class="sec-intro" data-reveal>${inline(c.process.intro)}</p>` : ''}
    </header>
  </div>
  <div class="hscroll" data-hscroll>
    <div class="hscroll-track">
      ${steps
        .map(
          (s, i) => `<article class="act" data-reveal>
        <div class="act-num" aria-hidden="true">${ROMAN[i] || i + 1}</div>
        <div class="act-label">${esc(s.label || '')}</div>
        <h3 class="act-title">${inline(s.title || '')}</h3>
        <p class="act-body">${inline(s.body || '')}</p>
        ${(s.chips || []).length ? `<ul class="chips">${s.chips.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}
      </article>`,
        )
        .join('')}
    </div>
    <div class="hscroll-progress" aria-hidden="true"><span></span></div>
  </div>
</section>`
      : '';

    const a = c.about;
    const about = `<section class="about-teaser" id="about">
  <div class="wrap about-grid">
    <div class="about-visual" data-reveal>
      ${portrait(a, site)}
      ${(a.now || []).length ? `<div class="now"><div class="now-title"><span class="dot"></span>Right now</div>${a.now.map((n) => `<div class="now-row"><span>${esc(n.label)}</span><p>${inline(n.text)}</p></div>`).join('')}</div>` : ''}
    </div>
    <div class="about-copy">
      ${eyebrow(a.eyebrow)}
      <h2 class="sec-title sec-title-md" data-split>${inline(a.title || '')}</h2>
      <div class="rich" data-reveal>${md(a.preview)}</div>
      <a class="btn btn-ghost magnetic" href="${href(ctx, '/about')}" data-reveal><span>Read the full story</span>${ARROW}</a>
    </div>
  </div>
  ${(a.stats || []).length ? `<div class="wrap"><div class="about-stats">${a.stats.map((s) => `<div class="about-stat" data-reveal><div class="about-stat-n" data-count>${esc(s.value)}</div><p>${inline(s.label)}</p></div>`).join('')}</div></div>` : ''}
</section>`;

    const sv = c.services;
    const services = (sv.items || []).length
      ? `<section class="services" id="services">
  <div class="wrap">
    <header class="sec-head">
      ${eyebrow(sv.eyebrow)}
      <h2 class="sec-title" data-split>${inline(sv.title || '')}</h2>
      ${sv.intro ? `<p class="sec-intro" data-reveal>${inline(sv.intro)}</p>` : ''}
    </header>
    <div class="svc-list">${sv.items
      .map(
        (s, i) => `<div class="svc" data-reveal>
      <span class="svc-num">${pad(i + 1)}</span>
      <h3 class="svc-title">${inline(s.title || '')}</h3>
      <div class="svc-body"><p>${inline(s.body || '')}</p>${(s.list || []).length ? `<ul>${s.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
    </div>`,
      )
      .join('')}</div>
  </div>
</section>`
      : '';

    const t = c.testimonials;
    const quotes = (t.items || []).filter((x) => x.quote && x.published !== false);
    const ask = site.email && t.requestTitle
      ? `<div class="tq tq-ask" data-reveal>
      <h3>${inline(t.requestTitle)}</h3>
      ${t.requestText ? `<p>${inline(t.requestText)}</p>` : ''}
      <a class="btn btn-primary magnetic" href="mailto:${esc(site.email)}?subject=${encodeURIComponent('A testimonial for your portfolio')}"><span>${esc(t.requestCta || 'Share a testimonial')}</span>${ARROW}</a>
    </div>`
      : '';
    const testimonials = t.show !== false && (quotes.length || ask)
      ? `<section class="testimonials" id="testimonials">
  <div class="wrap">
    <header class="sec-head">
      ${eyebrow(t.eyebrow)}
      <h2 class="sec-title" data-split>${inline(t.title || '')}</h2>
    </header>
    <div class="quote-grid">${quotes
      .map(
        (q) => `<figure class="tq" data-reveal>
      <span class="tq-mark" aria-hidden="true">“</span>
      <blockquote>${inline(q.quote)}</blockquote>
      <figcaption>${q.avatar ? media(q.avatar, { alt: plain(q.name), cls: 'tq-avatar' }) : `<span class="tq-avatar tq-initial">${esc((q.name || '?')[0])}</span>`}<span><strong>${esc(q.name || '')}</strong><span>${esc(q.role || '')}</span></span></figcaption>
    </figure>`,
      )
      .join('')}${ask}</div>
  </div>
</section>`
      : '';

    const scene = `<div class="scene" data-scene><div class="scene-pin"><div class="pane pane-hero">${heroHtml}</div>${manifesto ? `<div class="pane pane-next">${manifesto}</div>` : ''}</div></div>`;
    const main = [scene, marquee, work, others, testimonials, process, about, services, contact(ctx)].join('\n');
    return layout(ctx, {
      title: site.seoTitle || `${site.name} | ${site.role}`,
      description: site.seoDescription || '',
      bodyClass: 'is-home',
      main,
      path: '/',
    });
  }

  function portrait(a, site) {
    if (a.portrait) return `<figure class="portrait" data-clip>${media(a.portrait, { alt: `Portrait of ${site.name}` })}</figure>`;
    return `<figure class="portrait portrait-empty" data-clip aria-hidden="true"><span>${esc(site.initial || (site.name || 'V')[0])}</span></figure>`;
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
      ${site.email ? `<a class="btn btn-primary btn-xl magnetic" href="mailto:${esc(site.email)}"><span>${esc(ct.cta || 'Email me')}</span>${ARROW}</a>
      <button class="btn btn-ghost btn-xl" type="button" data-copy="${esc(site.email)}"><span data-copy-label>Copy email</span></button>` : ''}
      ${resume(site, 'btn btn-ghost btn-xl', 'Download résumé', DOWN)}
    </div>
    <div class="contact-meta" data-reveal>
      ${site.email ? `<div><span>Email</span><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></div>` : ''}
      ${site.phone && site.showPhone !== false ? `<div><span>Phone</span><a href="tel:${esc(site.phone.replace(/[^\d+]/g, ''))}">${esc(site.phone)}</a></div>` : ''}
      <div><span>Local time · ${esc((site.location || '').split(',')[0])}</span><strong data-clock="${esc(site.timezone || 'Africa/Lagos')}">--:--</strong></div>
      ${socials.length ? `<div><span>Elsewhere</span><p>${socials.map((s) => `<a href="${esc(safeUrl(s.url))}"${linkAttrs(s.url)}>${esc(s.label)} ↗</a>`).join('')}</p></div>` : ''}
    </div>
  </div>
  <div class="contact-giant" aria-hidden="true"><div class="contact-giant-track">${Array(4).fill(`<span>Let's talk</span><i>✦</i>`).join('')}</div></div>
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
      <div class="cs-tags" data-hero-item>${p.status ? `<span class="tag tag-strong">${esc(p.status)}</span>` : ''}${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${p.year ? `<span class="tag">${esc(p.year)}</span>` : ''}</div>
      <h1 class="cs-title">${lines(p.title)}</h1>
      ${p.hook ? `<p class="cs-hook" data-hero-item>${inline(p.hook)}</p>` : ''}
      ${(p.meta || []).length ? `<dl class="cs-meta" data-hero-item>${p.meta.map((m) => `<div><dt>${esc(m.label)}</dt><dd>${inline(m.value)}</dd></div>`).join('')}</dl>` : ''}
      ${links.length ? `<div class="cs-links" data-hero-item>${links.map((l, i) => `<a class="btn ${i === 0 ? 'btn-primary' : 'btn-ghost'} btn-sm magnetic" href="${esc(safeUrl(l.url))}"${linkAttrs(l.url)}><span>${esc(l.label)}</span>${ARROW_UR}</a>`).join('')}</div>` : ''}
    </div>
    ${p.heroImage || p.cover ? `<div class="wrap"><figure class="cs-hero-media" data-clip data-hero-media>${media(p.heroImage || p.cover, { alt: plain(p.title), eager: true })}</figure></div>` : ''}
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
        return wrap(`<figure class="figure" data-clip>${media(b.src, { alt: plain(b.caption || b.heading || '') })}${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`, b.wide ? ' is-wide' : '');
      }
      case 'gallery':
        return wrap(`<div class="gallery">${(b.images || []).filter((x) => x.src).map((x) => `<figure class="gallery-item" data-reveal>${media(x.src, { alt: plain(x.label || '') })}${x.label ? `<figcaption>${esc(x.label)}</figcaption>` : ''}</figure>`).join('')}</div>`);
      case 'quote':
        return wrap(`<figure class="pull" data-reveal><blockquote>“${inline(b.text || '')}”</blockquote>${b.attribution ? `<figcaption>${inline(b.attribution)}</figcaption>` : ''}</figure>`);
      case 'kpis':
        return wrap(stats(b.items, 'kpis'));
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
          ${resume(site, 'btn btn-ghost', 'Download résumé', DOWN)}
          ${(site.socials || []).filter((s) => safeUrl(s.url)).map((s) => `<a class="btn btn-ghost" href="${esc(safeUrl(s.url))}"${linkAttrs(s.url)}><span>${esc(s.label)}</span>${ARROW_UR}</a>`).join('')}
        </div>
      </div>
      <aside class="about-aside">
        ${(a.now || []).length ? `<div class="aside-block" data-reveal><h2>Right now</h2>${a.now.map((n) => `<div class="now-row"><span>${esc(n.label)}</span><p>${inline(n.text)}</p></div>`).join('')}</div>` : ''}
        ${(a.experience || []).length ? `<div class="aside-block" data-reveal><h2>Experience</h2>${a.experience.map((x) => `<div class="exp"><strong>${esc(x.role)}</strong><span>${esc(x.company)}</span><small>${esc([x.period, x.location].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>` : ''}
        ${(a.capabilities || []).length ? `<div class="aside-block" data-reveal><h2>Capabilities</h2><ul class="chips">${a.capabilities.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
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
