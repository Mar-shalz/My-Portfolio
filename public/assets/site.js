/* Small, progressive enhancements. Content and links never depend on motion. */
(() => {
  const d = document;
  const html = d.documentElement;
  const pageLocation = new URL(d.baseURI);
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');

  // Neutralize the previous animation boot state, including on cached pages.
  html.classList.remove('pt-enter', 'intro');
  html.classList.add('no-motion', 'interaction-ready');
  addEventListener('pageshow', () => html.classList.remove('pt-enter', 'intro'));

  const themeButtons = [...d.querySelectorAll('[data-theme-toggle]')];
  const updateThemeControls = () => {
    const isDark = html.dataset.theme === 'dark';
    themeButtons.forEach((button) => {
      button.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} theme`);
      button.setAttribute('aria-pressed', String(isDark));
    });
    d.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#111b20' : '#f6f4ee');
  };
  themeButtons.forEach((button) => button.addEventListener('click', () => {
    html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', html.dataset.theme); } catch {}
    updateThemeControls();
  }));
  updateThemeControls();

  // Keep keyboard focus inside the mobile navigation while it is open.
  const menuButton = d.querySelector('[data-menu-toggle]');
  const menu = d.getElementById('menu');
  const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let menuOpen = false;
  let previousFocus = null;
  const inertState = new Map();
  const background = [...d.querySelectorAll('main, .footer, .brand, .nav-links, .nav-actions > :not([data-menu-toggle]), .back-float, .skip')];

  function setMenu(open, restoreFocus = true) {
    if (!menu || !menuButton || open === menuOpen) return;
    menuOpen = open;
    html.classList.toggle('menu-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.setAttribute('aria-hidden', String(!open));
    menu.inert = !open;
    if (open) {
      previousFocus = d.activeElement;
      background.forEach((el) => { inertState.set(el, el.inert); el.inert = true; });
      menu.querySelector(focusable)?.focus({ preventScroll: true });
    } else {
      inertState.forEach((wasInert, el) => { el.inert = wasInert; });
      inertState.clear();
      if (restoreFocus) (previousFocus?.isConnected ? previousFocus : menuButton).focus({ preventScroll: true });
    }
  }

  if (menu && menuButton) {
    menu.inert = true;
    menuButton.addEventListener('click', () => setMenu(!menuOpen));
    menu.addEventListener('click', (event) => {
      const link = event.target.closest('a[href]');
      if (!link) return;
      setMenu(false);
      // Keep native hash navigation, and move assistive-technology focus with it.
      const url = new URL(link.href, d.baseURI);
      if (url.origin === pageLocation.origin && url.pathname === pageLocation.pathname && url.hash) {
        let target;
        try { target = d.getElementById(decodeURIComponent(url.hash.slice(1))); } catch {}
        if (target) requestAnimationFrame(() => {
          if (!target.hasAttribute('tabindex')) {
            target.setAttribute('tabindex', '-1');
            target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
          }
          target.focus({ preventScroll: true });
        });
      }
    });
    d.addEventListener('keydown', (event) => {
      if (!menuOpen) return;
      if (event.key === 'Escape') { event.preventDefault(); setMenu(false); return; }
      if (event.key !== 'Tab') return;
      const items = [menuButton, ...menu.querySelectorAll(focusable)].filter((el) => el.getClientRects().length && !el.inert);
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (d.activeElement === first || !items.includes(d.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (d.activeElement === last || !items.includes(d.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    });
    addEventListener('resize', () => {
      if (menuOpen && getComputedStyle(menuButton).display === 'none') setMenu(false, false);
    }, { passive: true });
    addEventListener('pageshow', () => setMenu(false, false));
  }

  const copyButtons = [...d.querySelectorAll('[data-copy]')];
  if (copyButtons.length) {
    const status = d.createElement('span');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    Object.assign(status.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' });
    d.body.append(status);
    copyButtons.forEach((button) => {
      const label = button.querySelector('[data-copy-label]') || button;
      const original = label.textContent;
      let reset;
      button.addEventListener('click', async () => {
        clearTimeout(reset);
        let copied = false;
        try { await navigator.clipboard.writeText(button.dataset.copy); copied = true; } catch {
          // Older browsers and non-secure local previews can still copy on a click.
          const field = d.createElement('textarea');
          field.value = button.dataset.copy;
          Object.assign(field.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
          d.body.append(field);
          field.select();
          try { copied = d.execCommand('copy'); } catch {}
          field.remove();
          button.focus({ preventScroll: true });
        }
        label.textContent = copied ? 'Copied ✓' : 'Copy unavailable';
        status.textContent = copied ? 'Email address copied to clipboard.' : `Please use the email link, or copy ${button.dataset.copy} manually.`;
        reset = setTimeout(() => { label.textContent = original; status.textContent = ''; }, 3000);
      });
    });
  }

  const clocks = [...d.querySelectorAll('[data-clock]')].flatMap((el) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: el.dataset.clock, timeZoneName: 'short' });
      return [{ el, formatter }];
    } catch { return []; }
  });
  const updateClocks = () => clocks.forEach(({ el, formatter }) => { el.textContent = formatter.format(new Date()); });
  updateClocks();
  if (clocks.length) setInterval(() => { if (!d.hidden) updateClocks(); }, 15000);
  d.addEventListener('visibilitychange', () => { if (!d.hidden) updateClocks(); });

  const nav = d.querySelector('[data-nav-root]');
  const progress = d.querySelector('.progress span');
  const tocProgress = d.querySelector('.toc-progress span');
  const content = d.querySelector('[data-cs-content]');
  const navLinks = [...d.querySelectorAll('.nav-link')];
  const sections = [...d.querySelectorAll('#work, #process, #about, #contact')];
  const stories = [...d.querySelectorAll('.story-project[id]')];
  const storyLinks = [...d.querySelectorAll('.story-index a[href]')].flatMap((link) => {
    try {
      const url = new URL(link.href, d.baseURI);
      const id = decodeURIComponent(url.hash.slice(1));
      if (url.origin !== pageLocation.origin || url.pathname !== pageLocation.pathname || !stories.some((story) => story.id === id)) return [];
      return [{ link, id }];
    } catch { return []; }
  });
  const tocLinks = [...d.querySelectorAll('[data-toc]')];
  const chapters = [...d.querySelectorAll('[data-chapter]')];
  const setActive = (links, value, attribute) => links.forEach((link) => {
    const active = link.dataset[attribute] === value;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  const nearest = (elements, position) => {
    let found = null;
    let closestTop = -Infinity;
    for (const element of elements) {
      if (!element.getClientRects().length) continue;
      const top = element.getBoundingClientRect().top;
      if (top <= position && top >= closestTop) { found = element; closestTop = top; }
    }
    return found;
  };
  let scrollFrame = 0;
  function updateScroll() {
    scrollFrame = 0;
    const max = html.scrollHeight - innerHeight;
    const clamp = (value) => Math.max(0, Math.min(1, value));
    nav?.classList.toggle('is-scrolled', scrollY > 16);
    if (progress) progress.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max) : 0})`;
    if (tocProgress && content) {
      const rect = content.getBoundingClientRect();
      tocProgress.style.transform = `scaleX(${rect.height ? clamp((innerHeight * .4 - rect.top) / rect.height) : 0})`;
    }
    const position = (nav?.offsetHeight || 76) + Math.min(150, innerHeight * .2);
    if (html.hasAttribute('data-home')) {
      const section = nearest(sections, position);
      setActive(navLinks, section ? `/#${section.id}` : '', 'nav');
    } else {
      setActive(navLinks, d.body.classList.contains('is-about') ? '/#about' : d.body.classList.contains('is-case') ? '/#work' : '', 'nav');
    }
    if (tocLinks.length) {
      const chapter = nearest(chapters, position);
      setActive(tocLinks, chapter?.id || '', 'toc');
    }
    if (storyLinks.length) {
      const visible = stories.filter((story) => {
        const rect = story.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > (nav?.offsetHeight || 76) && rect.top < innerHeight;
      });
      const current = nearest(visible, position) || visible.reduce((first, story) =>
        !first || story.getBoundingClientRect().top < first.getBoundingClientRect().top ? story : first, null);
      storyLinks.forEach(({ link, id }) => {
        const active = id === current?.id;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'step');
        else link.removeAttribute('aria-current');
      });
    }
  }
  const scheduleScroll = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll); };
  addEventListener('scroll', scheduleScroll, { passive: true });
  addEventListener('resize', scheduleScroll, { passive: true });
  addEventListener('load', scheduleScroll, { once: true });
  updateScroll();

  // Bounded native animation: every element is readable before this layer runs.
  const animations = new Set();
  function animate(el, frames, options = {}) {
    if (motionPreference.matches || typeof el.animate !== 'function') return null;
    const animation = el.animate(frames, { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)', ...options });
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    return animation;
  }

  if (scrollY < 50) d.querySelectorAll('.hero-type > span, .hero-lead, .hero-actions').forEach((el, index) => {
    animate(el, [{ opacity: .25, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 650, delay: index * 70, fill: 'backwards' });
  });

  // Fine-pointer flourishes are small and never displace the interaction target.
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const pointerResets = [];
  function pointerEffect(el, variables, limit, hitArea = el) {
    let frame = 0;
    let coordinates = null;
    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      coordinates = null;
      variables.forEach(([property, axis, scale, unit]) => el.style.setProperty(property, `0${unit}`));
    };
    const write = () => {
      frame = 0;
      if (!coordinates || !finePointer.matches || motionPreference.matches) return reset();
      const rect = hitArea.getBoundingClientRect();
      const [clientX, clientY] = coordinates;
      const values = {
        x: Math.max(-1, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1) * 2 - 1)),
        y: Math.max(-1, Math.min(1, (clientY - rect.top) / Math.max(rect.height, 1) * 2 - 1)),
      };
      variables.forEach(([property, axis, scale, unit]) => el.style.setProperty(property, `${(values[axis] * limit * scale).toFixed(2)}${unit}`));
    };
    hitArea.addEventListener('pointermove', (event) => {
      if (!finePointer.matches || motionPreference.matches || event.pointerType === 'touch') return;
      coordinates = [event.clientX, event.clientY];
      if (!frame) frame = requestAnimationFrame(write);
    }, { passive: true });
    hitArea.addEventListener('pointerleave', reset);
    hitArea.addEventListener('pointercancel', reset);
    hitArea.addEventListener('blur', reset);
    pointerResets.push(reset);
  }
  d.querySelectorAll('[data-magnetic]').forEach((button) => pointerEffect(button, [
    ['--magnetic-x', 'x', 1, 'px'], ['--magnetic-y', 'y', 1, 'px'],
  ], 4));
  d.querySelectorAll('.hero-portrait:not([data-portrait-motion="off"]) .portrait').forEach((portrait) => pointerEffect(portrait, [
    ['--portrait-rx', 'y', -1, 'deg'], ['--portrait-ry', 'x', 1, 'deg'],
    ['--portrait-x', 'x', 1, 'px'], ['--portrait-y', 'y', 1, 'px'],
  ], 3, portrait.closest('.hero-portrait')));
  finePointer.addEventListener('change', () => pointerResets.forEach((reset) => reset()));

  // Native modal semantics provide focus containment, Escape, and an inert page.
  const lightboxTriggers = [...d.querySelectorAll('[data-lightbox]')];
  if (lightboxTriggers.length) {
    const dialog = d.createElement('dialog');
    dialog.className = 'image-lightbox';
    dialog.setAttribute('aria-label', 'Project image preview');
    const close = d.createElement('button');
    close.className = 'lightbox-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close image preview');
    close.textContent = '×';
    const zoom = d.createElement('button');
    zoom.className = 'lightbox-zoom';
    zoom.type = 'button';
    zoom.textContent = 'View full size';
    zoom.setAttribute('aria-pressed', 'false');
    const figure = d.createElement('figure');
    figure.className = 'lightbox-content';
    figure.tabIndex = 0;
    figure.setAttribute('aria-label', 'Image detail; scroll to explore the full-size image');
    const image = d.createElement('img');
    image.className = 'lightbox-image';
    const caption = d.createElement('figcaption');
    caption.className = 'lightbox-caption';
    figure.append(image, caption);
    dialog.append(zoom, close, figure);
    d.body.append(dialog);
    let returnFocus = null;
    lightboxTriggers.forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        const source = trigger.dataset.src || trigger.querySelector('img')?.currentSrc;
        if (!source) return;
        let url;
        try { url = new URL(source, d.baseURI); } catch { return; }
        if (!['http:', 'https:'].includes(url.protocol)) return;
        event.preventDefault();
        if (typeof dialog.showModal !== 'function') { location.assign(url.href); return; }
        returnFocus = trigger;
        dialog.classList.remove('is-zoomed');
        zoom.textContent = 'View full size';
        zoom.setAttribute('aria-pressed', 'false');
        image.src = url.href;
        image.alt = trigger.dataset.alt || trigger.querySelector('img')?.alt || 'Project detail';
        caption.textContent = image.alt;
        dialog.showModal();
        html.classList.add('lightbox-open');
        close.focus({ preventScroll: true });
        animate(figure, [
          { transform: 'translateY(10px) scale(.99)' },
          { transform: 'translateY(0) scale(1)' },
        ], { duration: 300 });
      });
    });
    close.addEventListener('click', () => dialog.close());
    zoom.addEventListener('click', () => {
      const expanded = dialog.classList.toggle('is-zoomed');
      zoom.textContent = expanded ? 'Fit image' : 'View full size';
      zoom.setAttribute('aria-pressed', String(expanded));
      figure.scrollTop = 0;
      figure.scrollLeft = 0;
      if (expanded) figure.focus({ preventScroll: true });
    });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => {
      html.classList.remove('lightbox-open');
      returnFocus?.focus({ preventScroll: true });
    });
  }

  // Rotation never advances a quote while someone is reading or operating it.
  d.querySelectorAll('[data-testimonial-carousel]').forEach((carousel) => {
    const slides = [...carousel.querySelectorAll('[data-testimonial-slide]')];
    if (slides.length < 2) return;
    const track = carousel.querySelector('.testimonial-slides');
    const previous = carousel.querySelector('[data-carousel-prev]');
    const next = carousel.querySelector('[data-carousel-next]');
    const toggle = carousel.querySelector('[data-carousel-toggle]');
    const status = carousel.querySelector('[data-carousel-status]');
    let index = 0, timer, scrollTimer, hovered = false, toggleIntent;
    let paused = carousel.dataset.autoplay === 'false' || motionPreference.matches;
    carousel.classList.add('is-ready');
    carousel.querySelector('[data-carousel-controls]').hidden = false;
    track.setAttribute('tabindex', '0');
    track.setAttribute('aria-label', 'Testimonial slides. Use left and right arrow keys to navigate.');
    const positionOf = i => Math.max(0, Math.min(slides[i].offsetLeft - slides[0].offsetLeft, track.scrollWidth - track.clientWidth));
    const announce = () => { status.textContent = `${index + 1} / ${slides.length}`; };
    const sync = () => {
      clearTimeout(timer);
      const playing = !paused && !hovered && !d.hidden && !motionPreference.matches;
      carousel.dataset.playing = String(playing);
      toggle.textContent = paused ? 'Resume rotation' : 'Pause rotation';
      toggle.disabled = motionPreference.matches;
      toggle.setAttribute('aria-label', motionPreference.matches ? 'Rotation disabled by reduced-motion preference' : toggle.textContent);
      if (playing) timer = setTimeout(() => show(index + 1), 6000);
    };
    const show = (position, manual = false) => {
      index = (position + slides.length) % slides.length;
      if (manual) paused = true;
      status.setAttribute('aria-live', manual ? 'polite' : 'off');
      announce();
      track.scrollTo({ left: positionOf(index), behavior: motionPreference.matches ? 'instant' : 'smooth' });
      sync();
    };
    const pause = () => { paused = true; sync(); };
    previous.addEventListener('click', () => show(index - 1, true));
    next.addEventListener('click', () => show(index + 1, true));
    track.addEventListener('pointerdown', pause, { passive: true });
    track.addEventListener('wheel', pause, { passive: true });
    track.addEventListener('keydown', (event) => {
      if (event.target !== track || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      show(index + (event.key === 'ArrowRight' ? 1 : -1), true);
    });
    // Swipes and native keyboard scrolling must keep the controls on the visible quote.
    track.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        index = slides.reduce((closest, _, i) => Math.abs(positionOf(i) - track.scrollLeft) < Math.abs(positionOf(closest) - track.scrollLeft) ? i : closest, 0);
        status.setAttribute('aria-live', paused ? 'polite' : 'off');
        announce();
      }, 120);
    }, { passive: true });
    // Capture a mouse click's intent before focus pauses the carousel.
    toggle.addEventListener('pointerdown', () => { toggleIntent = !paused; });
    toggle.addEventListener('pointercancel', () => { toggleIntent = undefined; });
    toggle.addEventListener('blur', () => { toggleIntent = undefined; });
    toggle.addEventListener('click', (event) => {
      paused = event.detail && toggleIntent !== undefined ? toggleIntent : !paused;
      toggleIntent = undefined;
      sync();
    });
    carousel.addEventListener('pointerenter', () => { hovered = true; sync(); });
    carousel.addEventListener('pointerleave', () => { hovered = false; sync(); });
    carousel.addEventListener('focusin', pause);
    d.addEventListener('visibilitychange', sync);
    motionPreference.addEventListener('change', () => {
      if (motionPreference.matches) { paused = true; track.scrollTo({ left: positionOf(index), behavior: 'instant' }); }
      sync();
    });
    announce();
    sync();
  });

  const resumeDialog = d.getElementById('resume-dialog');
  if (resumeDialog && typeof resumeDialog.showModal === 'function') {
    const frame = resumeDialog.querySelector('[data-resume-frame]');
    const close = resumeDialog.querySelector('[data-resume-close]');
    let returnFocus;
    d.querySelectorAll('[data-resume-preview]').forEach((trigger) => trigger.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      let url;
      try { url = new URL(trigger.dataset.resumeSrc, d.baseURI); } catch { return; }
      if (url.protocol !== 'https:' && !(url.origin === pageLocation.origin && url.protocol === 'http:')) return;
      event.preventDefault();
      returnFocus = trigger;
      frame.src = url.href;
      resumeDialog.showModal();
      html.classList.add('resume-open');
      close.focus({ preventScroll: true });
      animate(resumeDialog, [{ transform: 'translateY(18px)' }, { transform: 'translateY(0)' }]);
    }));
    close.addEventListener('click', () => resumeDialog.close());
    resumeDialog.addEventListener('click', (event) => { if (event.target === resumeDialog) resumeDialog.close(); });
    resumeDialog.addEventListener('close', () => {
      html.classList.remove('resume-open');
      frame.removeAttribute('src');
      returnFocus?.focus({ preventScroll: true });
    });
  }

  // Count only single numeric values; ranges and prose keep their exact original text.
  const counting = new Map();
  let countObserver;
  function countUp(el) {
    const original = el.textContent;
    const parts = original.match(/^([^\d+-]*)([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([^\d]*)$/);
    if (!parts) return;
    const [, prefix, number, suffix] = parts;
    const target = Number(number.replaceAll(',', ''));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = number.split('.')[1]?.length || 0;
    const format = value => {
      let text = value.toFixed(decimals);
      if (number.includes(',')) { const chunks = text.split('.'); chunks[0] = chunks[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); text = chunks.join('.'); }
      return prefix + (number.startsWith('+') ? '+' : '') + text + suffix;
    };
    el.setAttribute('aria-label', original);
    const run = { original, frame: 0, start: null };
    counting.set(el, run);
    const tick = time => {
      run.start ??= time;
      const progress = Math.min(1, (time - run.start) / 1150);
      el.textContent = progress === 1 ? original : format(target * (1 - (1 - progress) ** 3));
      if (progress < 1) run.frame = requestAnimationFrame(tick);
      else counting.delete(el);
    };
    run.frame = requestAnimationFrame(tick);
  }
  function finishCounts() {
    counting.forEach(({ original, frame }, el) => { cancelAnimationFrame(frame); el.textContent = original; });
    counting.clear();
  }
  if (!motionPreference.matches && 'IntersectionObserver' in window) {
    countObserver = new IntersectionObserver(entries => entries.forEach(({ isIntersecting, target }) => {
      if (!isIntersecting) return;
      countObserver.unobserve(target);
      countUp(target);
    }), { threshold: .5 });
    d.querySelectorAll('[data-count]').forEach(el => countObserver.observe(el));
  }
  d.addEventListener('visibilitychange', () => { if (d.hidden) finishCounts(); });

  let revealObserver;
  if (!motionPreference.matches && 'IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter(({ isIntersecting }) => isIntersecting);
      visible.forEach(({ target }, index) => {
        revealObserver.unobserve(target);
        animate(target, [
          { opacity: .35, transform: 'translate3d(0, 24px, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ], { delay: Math.min(index * 35, 105), fill: 'backwards' });
      });
    }, { threshold: .08, rootMargin: '0px 0px -24px 0px' });
    const reveals = [...d.querySelectorAll('[data-reveal], [data-count], .cs-hero-media, .supporting-project')];
    // An ancestor's entrance already carries its descendants, avoiding double movement.
    const revealSet = new Set(reveals);
    reveals.filter((el) => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) if (revealSet.has(parent)) return false;
      return true;
    }).forEach((el) => revealObserver.observe(el));
  }
  motionPreference.addEventListener('change', ({ matches }) => {
    scheduleScroll();
    if (!matches) return;
    revealObserver?.disconnect();
    countObserver?.disconnect();
    finishCounts();
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    pointerResets.forEach((reset) => reset());
  });
})();
