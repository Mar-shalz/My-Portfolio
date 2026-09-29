/* Motion + interaction layer for the portfolio.
   Everything works without this file; with it, the site plays like a story:
   curtain transitions, split-line headlines, a scroll-lit prologue, stacked
   project cards, a pinned horizontal "method" section and live counters. */
(() => {
  const d = document;
  const html = d.documentElement;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  let lenis = null;

  /* ---------------------------------------------------------------- always on */

  d.querySelectorAll('[data-theme-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
      html.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch {}
    }),
  );

  const menuBtn = d.querySelector('[data-menu-toggle]');
  const menu = d.getElementById('menu');
  const setMenu = (open) => {
    html.classList.toggle('menu-open', open);
    menuBtn?.setAttribute('aria-expanded', String(open));
    menuBtn?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu?.setAttribute('aria-hidden', String(!open));
    if (lenis) open ? lenis.stop() : lenis.start();
  };
  menuBtn?.addEventListener('click', () => setMenu(!html.classList.contains('menu-open')));
  menu?.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && html.classList.contains('menu-open')) setMenu(false); });

  d.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      const label = b.querySelector('[data-copy-label]') || b;
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        label.textContent = 'Copied ✓';
      } catch {
        location.href = `mailto:${b.dataset.copy}`;
      }
      setTimeout(() => { label.textContent = 'Copy email'; }, 2200);
    }),
  );

  d.querySelectorAll('[data-clock]').forEach((el) => {
    let fmt;
    try {
      fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: el.dataset.clock, timeZoneName: 'short' });
    } catch { return; }
    const tick = () => { el.textContent = fmt.format(new Date()); };
    tick();
    setInterval(tick, 15000);
  });

  // Nav: always visible, turns to glass once you scroll. Reading progress bar.
  const nav = d.querySelector('[data-nav-root]');
  const bar = d.querySelector('.progress span');
  const tocBar = d.querySelector('.toc-progress span');
  const content = d.querySelector('[data-cs-content]');
  const onScroll = () => {
    const y = scrollY;
    const max = html.scrollHeight - innerHeight;
    nav?.classList.toggle('is-scrolled', y > 20);
    if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    if (tocBar && content) {
      const r = content.getBoundingClientRect();
      const p = (innerHeight * 0.5 - r.top) / r.height;
      tocBar.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`;
    }
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Active nav link for the section in view (home) or the current page.
  const navLinks = [...d.querySelectorAll('.nav-link')];
  const setActive = (key) => navLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.nav === key));
  if (html.hasAttribute('data-home')) {
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target.id, e.isIntersecting));
      const id = ['contact', 'about', 'process', 'work'].find((k) => seen.get(k));
      setActive(id ? `/#${id}` : '');
    }, { rootMargin: '-45% 0px -50% 0px' });
    ['work', 'process', 'about', 'contact'].forEach((id) => { const el = d.getElementById(id); if (el) io.observe(el); });
  } else if (d.body.classList.contains('is-about')) {
    setActive('/#about');
  } else if (d.body.classList.contains('is-case')) {
    setActive('/#work');
  }

  // Case-study chapter nav.
  const tocLinks = [...d.querySelectorAll('[data-toc]')];
  if (tocLinks.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        tocLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.toc === e.target.id));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    d.querySelectorAll('[data-chapter]').forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------------- motion */

  if (html.classList.contains('no-motion') || !window.gsap || !window.ScrollTrigger || !window.SplitText) {
    html.classList.add('no-motion');
    html.classList.remove('pt-enter', 'intro');
    return;
  }
  html.classList.add('motion-ready');

  const { gsap, ScrollTrigger, SplitText } = window;
  gsap.registerPlugin(ScrollTrigger, SplitText);
  const mm = gsap.matchMedia();
  const navH = () => nav?.offsetHeight || 72;

  if (window.Lenis) {
    lenis = new window.Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  const scrollToEl = (el, immediate = false) => {
    const offset = el.hasAttribute('data-chapter') ? -(navH() + 24) : 0;
    if (lenis) lenis.scrollTo(el, { offset, immediate, duration: 1.4 });
    else el.scrollIntoView({ behavior: immediate ? 'auto' : 'smooth' });
  };

  // ---------- curtain page transitions ----------
  const curtain = d.querySelector('.curtain');
  const mark = curtain?.querySelector('.curtain-mark');
  const count = curtain?.querySelector('.curtain-count');
  const cname = curtain?.querySelector('.curtain-name');
  const entering = html.classList.contains('pt-enter');
  const isIntro = html.classList.contains('intro');
  if (curtain) gsap.set(curtain, { y: 0, yPercent: entering ? 0 : 100 });

  function leave(href) {
    try { sessionStorage.setItem('pt', '1'); } catch {}
    if (!curtain) return void (location.href = href);
    gsap.timeline({ onComplete: () => { location.href = href; } })
      .set(curtain, { yPercent: 100 })
      .set([count, cname], { opacity: 0 })
      .to(curtain, { yPercent: 0, duration: 0.7, ease: 'expo.inOut' })
      .fromTo(mark, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'power3.out' }, '-=0.3');
  }

  addEventListener('pageshow', (e) => {
    if (e.persisted && curtain) {
      gsap.set(curtain, { yPercent: 100 });
      html.classList.remove('pt-enter', 'intro');
    }
  });

  d.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
    if (url.pathname === location.pathname && url.hash) {
      const target = d.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      e.preventDefault();
      scrollToEl(target);
      history.replaceState(null, '', url.hash);
      return;
    }
    if (url.pathname === location.pathname && !url.hash) {
      e.preventDefault();
      if (lenis) lenis.scrollTo(0, { duration: 1.4 }); else scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (/^\/(admin|api|uploads)\b/.test(url.pathname)) return;
    e.preventDefault();
    leave(url.href);
  });

  // ---------- intro ----------
  function intro() {
    const tl = gsap.timeline();
    if (entering && curtain) {
      if (isIntro && count) {
        const o = { v: 0 };
        tl.fromTo(cname, { opacity: 0, y: 10 }, { opacity: 0.9, y: 0, duration: 0.5 }, 0)
          .fromTo(mark, { opacity: 0, yPercent: 30 }, { opacity: 1, yPercent: 0, duration: 0.9, ease: 'expo.out' }, 0)
          .to(o, { v: 100, duration: 1.5, ease: 'power2.inOut', onUpdate: () => { count.textContent = Math.round(o.v); } }, 0)
          .to([mark, count, cname], { opacity: 0, duration: 0.35 }, '>-0.05');
      } else {
        tl.to(mark, { opacity: 0, duration: 0.3 }, 0.1);
      }
      tl.to(curtain, { yPercent: -100, duration: 1, ease: 'expo.inOut', onComplete: () => {
        gsap.set(curtain, { yPercent: 100 });
        html.classList.remove('pt-enter', 'intro');
      } }, '>-0.1');
      tl.addLabel('reveal', '-=0.55');
    } else {
      tl.addLabel('reveal', 0.05);
    }
    tl.to('.line-in', { y: 0, duration: 1.4, ease: 'expo.out', stagger: 0.1 }, 'reveal')
      .to('[data-hero-item]', { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.08 }, 'reveal+=0.35');
    const heroMedia = d.querySelector('[data-hero-media]');
    if (heroMedia) {
      tl.fromTo(heroMedia, { clipPath: 'inset(12% 10% 0% 10% round 30px)' }, { clipPath: 'inset(0% 0% 0% 0% round 30px)', duration: 1.6, ease: 'expo.inOut' }, 'reveal+=0.2');
      const img = heroMedia.querySelector('img,video');
      if (img) tl.fromTo(img, { scale: 1.25 }, { scale: 1, duration: 2, ease: 'expo.out' }, 'reveal+=0.2');
    }
    return tl;
  }

  // ---------- counters ----------
  function counters(heroDelay) {
    d.querySelectorAll('[data-count]').forEach((el) => {
      const final = el.textContent.trim();
      const m = final.match(/^([^\d]*)(\d[\d,]*(?:\.\d+)?)(.*)$/);
      if (!m) return;
      const [, pre, num, suf] = m;
      const target = parseFloat(num.replace(/,/g, ''));
      if (!isFinite(target) || target === 0) return;
      const dec = (num.split('.')[1] || '').length;
      const comma = num.includes(',');
      const o = { v: 0 };
      const show = () => {
        let s = o.v.toFixed(dec);
        if (comma) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: dec });
        el.textContent = pre + s + suf;
      };
      show();
      const inHero = el.closest('[data-hero]');
      gsap.to(o, {
        v: target, duration: 1.8, ease: 'expo.out', delay: inHero ? heroDelay : 0,
        onUpdate: show, onComplete: () => { el.textContent = final; },
        scrollTrigger: inHero ? undefined : { trigger: el, start: 'top 92%', once: true },
      });
    });
  }

  // ---------- scroll scenes ----------
  function scenes() {
    // Split-line headline reveals.
    d.querySelectorAll('[data-split]').forEach((el) => {
      SplitText.create(el, {
        type: 'lines', mask: 'lines', linesClass: 'split-line', autoSplit: true,
        onSplit(self) {
          gsap.set(el, { visibility: 'visible' });
          return gsap.from(self.lines, {
            yPercent: 110, duration: 1.25, ease: 'expo.out', stagger: 0.09,
            scrollTrigger: { trigger: el, start: 'top 90%', once: true },
          });
        },
      });
    });

    // Fade-up reveals, batched so neighbours stagger together.
    ScrollTrigger.batch('[data-reveal]', {
      start: 'top 90%', once: true,
      onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.08, overwrite: 'auto' }),
    });

    // Clip-path image reveals with a slow counter-zoom.
    gsap.utils.toArray('[data-clip]:not([data-hero-media])').forEach((el) => {
      gsap.fromTo(el, { clipPath: 'inset(10% 8% 10% 8% round 24px)' }, {
        clipPath: 'inset(0% 0% 0% 0% round 24px)', ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 95%', end: 'top 45%', scrub: 0.6 },
      });
      const img = el.querySelector('img,video');
      if (img) gsap.fromTo(img, { scale: 1.15 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom 30%', scrub: true } });
    });

    // Hero drifts away as the story begins.
    const hero = d.querySelector('[data-hero]');
    if (hero) {
      const glow = hero.querySelector('.hero-glow');
      if (glow && fine) {
        gsap.set(glow, { xPercent: -50, yPercent: -50, x: 0, y: 0 });
        const qx = gsap.quickTo(glow, 'x', { duration: 2, ease: 'power3' });
        const qy = gsap.quickTo(glow, 'y', { duration: 2, ease: 'power3' });
        hero.addEventListener('pointermove', (e) => {
          const r = hero.getBoundingClientRect();
          qx((e.clientX - r.width / 2) * 0.15);
          qy((e.clientY - r.height / 2) * 0.15);
        });
      }
    }

    // Prologue: words light up as you read. Pinned on larger screens.
    const words = d.querySelector('[data-words]');
    if (words) {
      const split = SplitText.create(words, { type: 'words', wordsClass: 'word' });
      const scene = d.querySelector('[data-scene]');
      // Large screens: the hero tilts back and fades while the prologue rises in its place,
      // its words light up, then it tilts away the same way. Mirrors the previous portfolio.
      mm.add('(min-width: 901px)', () => {
        const ph = scene.querySelector('.pane-hero');
        const pn = scene.querySelector('.pane-next');
        const tl = gsap.timeline({
          scrollTrigger: { trigger: scene.querySelector('.scene-pin'), start: 'top top', end: '+=260%', pin: true, scrub: 0.8 },
        });
        tl.to(ph, { opacity: 0, rotationX: -22, yPercent: -3.5, scale: 0.95, ease: 'power1.in', duration: 0.26 }, 0)
          .fromTo(pn, { opacity: 0, yPercent: 4.5 }, { opacity: 1, yPercent: 0, ease: 'power2.out', duration: 0.22 }, 0.18)
          .set(pn, { pointerEvents: 'auto' }, 0.3)
          .fromTo(split.words, { opacity: 0.12 }, { opacity: 1, ease: 'none', duration: 0.05, stagger: { amount: 0.36 } }, 0.36)
          .to(pn, { opacity: 0, rotationX: -22, yPercent: -3.5, scale: 0.95, ease: 'power1.in', duration: 0.16 }, 0.84);
        return () => gsap.set([ph, pn], { clearProps: 'all' });
      });
      mm.add('(max-width: 900px)', () => {
        gsap.fromTo(split.words, { opacity: 0.12 }, {
          opacity: 1, stagger: 0.1, ease: 'none',
          scrollTrigger: { trigger: words, start: 'top 80%', end: 'bottom 50%', scrub: 0.5 },
        });
      });
    }

    // Marquees: endless loop that speeds up and skews with scroll velocity.
    d.querySelectorAll('[data-marquee], .contact-giant').forEach((m) => {
      const track = m.querySelector('.marquee-track, .contact-giant-track');
      if (!track) return;
      const loop = gsap.to(track, { xPercent: -50, duration: m.matches('.contact-giant') ? 60 : 45, ease: 'none', repeat: -1 });
      const skew = gsap.quickTo(track, 'skewX', { duration: 0.5, ease: 'power3' });
      let dir = 1;
      let settle;
      ScrollTrigger.create({
        trigger: m, start: 'top bottom', end: 'bottom top',
        onUpdate(self) {
          dir = self.direction;
          const v = self.getVelocity();
          gsap.to(loop, { timeScale: dir * (1 + Math.min(Math.abs(v) / 600, 2)), duration: 0.25, overwrite: true });
          skew(gsap.utils.clamp(-3, 3, v / -600));
          clearTimeout(settle);
          settle = setTimeout(() => { gsap.to(loop, { timeScale: dir, duration: 1.2 }); skew(0); }, 120);
        },
      });
    });

    // Work: sticky stacked cards that recede as the next story arrives.
    const cards = gsap.utils.toArray('[data-stack-card]');
    const work = d.getElementById('work');
    cards.forEach((card, i) => {
      const pc = getComputedStyle(card).getPropertyValue('--pc').trim();
      ScrollTrigger.create({
        trigger: card, start: 'top 65%',
        onEnter: () => work?.style.setProperty('--tint', pc),
        onLeaveBack: () => {
          const prev = cards[i - 1];
          work?.style.setProperty('--tint', prev ? getComputedStyle(prev).getPropertyValue('--pc').trim() : 'transparent');
        },
      });
      const img = card.querySelector('[data-parallax]');
      const fill = card.querySelector('.stack-media.is-fill');
      if (img) gsap.fromTo(img, { yPercent: fill ? -5 : 5 }, { yPercent: fill ? 5 : -4, ease: 'none', scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    mm.add('(min-width: 901px)', () => {
      cards.forEach((card, i) => {
        card.style.top = `${navH() + 12 + i * 14}px`;
        const next = cards[i + 1];
        if (!next) return;
        const st = { trigger: next, start: 'top bottom', end: () => `top ${navH() + 40}px`, scrub: true };
        gsap.to(card.querySelector('.stack-inner'), { scale: 0.9, ease: 'none', scrollTrigger: st });
        gsap.to(card.querySelector('.stack-shade'), { opacity: 0.42, ease: 'none', scrollTrigger: { ...st } });
      });
      return () => cards.forEach((c) => { c.style.top = ''; });
    });

    // Method: pinned horizontal acts.
    mm.add('(min-width: 901px)', () => {
      const wrap = d.querySelector('[data-hscroll]');
      if (!wrap) return;
      const track = wrap.querySelector('.hscroll-track');
      const prog = wrap.querySelector('.hscroll-progress span');
      const dist = () => Math.max(0, track.scrollWidth - innerWidth);
      if (dist() < 40) return;
      gsap.to(track, {
        x: () => -dist(), ease: 'none',
        scrollTrigger: {
          trigger: wrap, start: 'center center', end: () => `+=${dist()}`, pin: true, scrub: 0.8, invalidateOnRefresh: true,
          onUpdate: (s) => { if (prog) prog.style.transform = `scaleX(${s.progress})`; },
        },
      });
    });

    // Next-project title slides in.
    const next = d.querySelector('.next-title');
    if (next) gsap.from(next, { xPercent: 8, opacity: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: next, start: 'top 90%', once: true } });
  }

  // ---------- pointer toys ----------
  function pointer() {
    if (!fine) return;
    d.querySelectorAll('.magnetic').forEach((el) => {
      const qx = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3' });
      const qy = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        qx((e.clientX - r.left - r.width / 2) * 0.28);
        qy((e.clientY - r.top - r.height / 2) * 0.38);
      });
      el.addEventListener('pointerleave', () => { qx(0); qy(0); });
    });

    d.querySelectorAll('.tilt').forEach((el) => {
      gsap.set(el, { transformPerspective: 1000 });
      const rx = gsap.quickTo(el, 'rotationX', { duration: 0.8, ease: 'power3' });
      const ry = gsap.quickTo(el, 'rotationY', { duration: 0.8, ease: 'power3' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 7);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 7);
      });
      el.addEventListener('pointerleave', () => { rx(0); ry(0); });
    });

    const cur = d.querySelector('.cursor');
    if (!cur) return;
    const label = cur.querySelector('.cursor-label');
    const cx = gsap.quickTo(cur, 'x', { duration: 0.5, ease: 'power3' });
    const cy = gsap.quickTo(cur, 'y', { duration: 0.5, ease: 'power3' });
    addEventListener('pointermove', (e) => { cx(e.clientX); cy(e.clientY); cur.classList.add('is-on'); }, { passive: true });
    html.addEventListener('pointerleave', () => cur.classList.remove('is-on'));
    d.addEventListener('pointerover', (e) => {
      const t = e.target.closest('[data-cursor]');
      if (t) {
        label.textContent = t.dataset.cursor;
        cur.classList.add('has-label');
        cur.classList.remove('is-hover');
      } else {
        cur.classList.remove('has-label');
        cur.classList.toggle('is-hover', Boolean(e.target.closest('a, button')));
      }
    });
  }

  // ---------- boot ----------
  const fontsReady = Promise.race([d.fonts?.ready || Promise.resolve(), new Promise((r) => setTimeout(r, 1200))]);
  fontsReady.then(() => {
    try {
      const tl = intro();
      scenes();
      counters(Math.max(0, tl.duration() - 1.2));
      pointer();
    } catch (err) {
      // Never leave content hidden: drop every animation and show the page as-is.
      console.error(err);
      ScrollTrigger.getAll().forEach((t) => t.kill());
      gsap.set('[data-reveal],[data-hero-item],.line-in,[data-split],[data-clip],.curtain', { clearProps: 'all' });
      html.classList.add('no-motion');
      html.classList.remove('pt-enter', 'intro');
      return;
    }
    ScrollTrigger.refresh();
    if (location.hash) {
      const target = d.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) requestAnimationFrame(() => scrollToEl(target, true));
    }
  });
})();
