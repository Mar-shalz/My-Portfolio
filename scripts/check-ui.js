import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRenderer, resumePreviewUrl } from '../lib/render.js';
import { normalize } from '../lib/store.js';

const content = normalize(JSON.parse(fs.readFileSync(new URL('../data/content.json', import.meta.url))));
const renderer = createRenderer();
const render = c => renderer.home({ c, base: '', preview: false });
let html = render(content);
assert(!html.includes('class="story-title-link"'));
assert.equal((html.match(/class="story-cover-cta"/g) || []).length, 3);
assert(!html.includes('class="btn btn-primary case-link"'));
assert(html.includes('data-resume-preview'));
assert(!html.slice(html.indexOf('class="hero-actions"'), html.indexOf('class="hero-availability"')).includes('data-resume-preview'));
assert(html.includes('nav-resume"'));
assert(html.includes('UI/UX'));
assert(html.includes('Product Design &amp; UI/UX Lead'));
assert(html.includes('I lead a team of designers'));
assert(!html.includes('SAMPLE:'));
const previewHtml = renderer.home({ c: content, base: '', preview: true });
assert(previewHtml.includes('<base href="/">'));
assert(previewHtml.includes('Preview: unpublished draft.'));
assert.equal((previewHtml.match(/class="story-cover-cta"/g) || []).length, 3);
assert(previewHtml.includes(content.projects[0].cover));
assert(previewHtml.includes('Read case study'));
assert(!previewHtml.includes('>Preview</span>'));
const publicPages = [html, renderer.about({ c: content, base: '', preview: false }),
  ...content.projects.filter(p => p.published && p.kind === 'case-study').map(p => renderer.caseStudy({ c: content, base: '', preview: false }, p))];
assert(publicPages.every(page => !page.includes('—')), 'Public pages must not contain em dashes');
assert.equal(resumePreviewUrl('javascript:alert(1)'), '');
assert.equal(resumePreviewUrl('https://drive.google.com.evil.test/file/d/abc/view'), '');
assert.equal(resumePreviewUrl('http://example.com/resume.pdf'), '');
assert.equal(resumePreviewUrl('/uploads/resume.pdf'), '/uploads/resume.pdf');
assert.equal(resumePreviewUrl('https://drive.google.com/file/d/abc-123/view?usp=sharing'), 'https://drive.google.com/file/d/abc-123/preview');
assert.equal(resumePreviewUrl('https://drive.google.com/drive/folders/abc-123'), 'https://drive.google.com/embeddedfolderview?id=abc-123#list');
const fixture = structuredClone(content);
fixture.testimonials.items = [{ name: 'Test only', quote: 'First fixture quote.', published: true }, { name: 'Test only', quote: 'Second fixture quote.', published: true }];
html = render(fixture);
assert.equal((html.match(/data-testimonial-slide /g) || []).length, 2);
assert(html.includes('data-carousel-controls hidden'));
fixture.testimonials.show = false;
assert(!render(fixture).includes('data-testimonial-carousel'));
fixture.projects[0].cover = '/uploads/replacement.jpg';
fixture.projects[0].storyCta = 'Explore the mobile story';
assert(render(fixture).includes('/uploads/replacement.jpg'));
assert(render(fixture).includes('<span>Explore the mobile story</span>'));

// Exercise the shipped carousel handlers with a tiny DOM and controllable clock.
const source = fs.readFileSync(new URL('../public/assets/site.js', import.meta.url), 'utf8');
const carouselCode = source.slice(source.indexOf('  // Rotation never'), source.indexOf('  const resumeDialog'));
function element() {
  return { dataset: {}, hidden: false, attributes: {}, handlers: {}, classList: { add() {} },
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(k, fn) { this.handlers[k] = fn; },
    fire(k, event = {}) { this.handlers[k]?.(event); } };
}
function setup({ count = 2, reduced = false, autoplay = true } = {}) {
  const carousel = element(), slides = Array.from({ length: count }, (_, i) => ({ ...element(), offsetLeft: i * 956 }));
  const controls = Object.fromEntries(['prev', 'next', 'toggle', 'status', 'controls'].map(k => [k, element()]));
  const track = { ...element(), scrollLeft: 0, clientWidth: 1000, scrollWidth: count * 956 - 24, scrolls: [],
    scrollTo(options) { this.scrolls.push(options); this.scrollLeft = options.left; this.fire('scroll'); } };
  controls.controls.hidden = true;
  carousel.dataset.autoplay = String(autoplay);
  carousel.querySelectorAll = () => slides;
  carousel.querySelector = selector => selector === '.testimonial-slides' ? track : controls[selector.replace('[data-carousel-', '').replace(']', '')];
  const d = { ...element(), hidden: false, querySelectorAll: () => [carousel] };
  const preference = { ...element(), matches: reduced };
  const timers = new Map(); let id = 0;
  vm.runInNewContext(carouselCode, { d, motionPreference: preference,
    setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; }, clearTimeout(key) { timers.delete(key); } });
  return { carousel, track, slides, controls, d, preference, timers,
    get playing() { return [...timers.values()].filter(t => t.delay === 6000).length; },
    tick(delay = 6000) { const [key, timer] = [...timers].find(([, t]) => t.delay === delay); timers.delete(key); timer.fn(); } };
}
let c = setup();
assert(c.slides.every(slide => !slide.hidden), 'Every quote stays in the horizontal track');
assert.equal(c.track.attributes.tabindex, '0');
c.tick(); assert.equal(c.track.scrolls.at(-1).left, 888); assert.equal(c.track.scrolls.at(-1).behavior, 'smooth');
c.tick(120); assert.equal(c.controls.status.textContent, '2 / 2');
c.tick(); assert.equal(c.track.scrolls.at(-1).left, 0);
c.carousel.fire('pointerenter'); assert.equal(c.playing, 0);
c.carousel.fire('pointerleave'); assert.equal(c.playing, 1);
c.carousel.fire('focusin', { target: c.controls.next }); assert.equal(c.playing, 0);
c.controls.prev.fire('click'); assert.equal(c.controls.status.textContent, '2 / 2');
assert.equal(c.controls.status.attributes['aria-live'], 'polite');
c.controls.toggle.fire('click'); assert.equal(c.playing, 1);
c.controls.toggle.fire('pointerdown');
c.carousel.fire('focusin', { target: c.controls.toggle });
assert.equal(c.playing, 0);
c.controls.toggle.fire('click', { detail: 1 }); assert.equal(c.playing, 0);
c.controls.toggle.fire('click'); assert.equal(c.playing, 1);
c.d.hidden = true; c.d.fire('visibilitychange'); assert.equal(c.playing, 0);
c.d.hidden = false; c.d.fire('visibilitychange'); assert.equal(c.playing, 1);
c.preference.matches = true; c.preference.fire('change'); assert.equal(c.playing, 0);
assert.equal(c.controls.toggle.disabled, true);
assert.equal(c.track.scrolls.at(-1).behavior, 'instant');
assert.equal(setup({ count: 1 }).controls.controls.hidden, true);
assert.equal(setup({ count: 1 }).track.scrolls.length, 0);
assert.equal(setup({ reduced: true }).playing, 0);
assert.equal(setup({ autoplay: false }).playing, 0);
c = setup({ count: 3 });
c.track.fire('pointerdown'); assert.equal(c.playing, 0);
c.track.scrollLeft = 956; c.track.fire('scroll'); c.tick(120);
assert.equal(c.controls.status.textContent, '2 / 3', 'A native swipe updates the active quote');
c.controls.next.fire('click'); assert.equal(c.track.scrolls.at(-1).left, 1844);
let prevented = false;
c.track.fire('keydown', { target: c.track, key: 'ArrowRight', preventDefault() { prevented = true; } });
assert.equal(prevented, true); assert.equal(c.track.scrolls.at(-1).left, 0);
c.controls.toggle.fire('click'); assert.equal(c.playing, 1);
c.track.fire('wheel'); assert.equal(c.playing, 0);

// The real count-up code is exercised against a controllable viewport observer and frame clock.
const countCode = source.slice(source.indexOf('  // Count only'), source.indexOf('  let revealObserver;'));
const reduceCode = source.slice(source.lastIndexOf("  motionPreference.addEventListener('change', ({ matches })"), source.lastIndexOf('})();'));
function setupCounts({ reduced = false } = {}) {
  const values = ['41K+', '250+', '6+', '1,250.50+', '₦2.5M', '1–3 years', '+15%', '0'];
  const nodes = values.map(textContent => ({ ...element(), textContent }));
  const frames = new Map(), observed = new Set(); let observerCallback, id = 0, disconnected = false;
  const d = { ...element(), hidden: false, querySelectorAll: () => nodes };
  const preference = { ...element(), matches: reduced };
  class Observer {
    constructor(callback) { observerCallback = callback; }
    observe(el) { observed.add(el); }
    unobserve(el) { observed.delete(el); }
    disconnect() { observed.clear(); disconnected = true; }
  }
  vm.runInNewContext(countCode + 'let revealObserver;\n' + reduceCode, {
    d, motionPreference: preference, window: { IntersectionObserver: Observer }, IntersectionObserver: Observer,
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(key) { frames.delete(key); },
    scheduleScroll() {}, animations: new Set(), pointerResets: [],
  });
  return { nodes, values, frames, observed, d, preference, get disconnected() { return disconnected; },
    enter(el) { observerCallback([{ target: el, isIntersecting: true }]); },
    frame(time) { const jobs = [...frames]; frames.clear(); jobs.forEach(([, fn]) => fn(time)); } };
}
let counts = setupCounts();
assert.equal(counts.observed.size, 8);
assert.equal(counts.frames.size, 0, 'Counters wait until visible');
counts.nodes.forEach(el => counts.enter(el));
assert.equal(counts.observed.size, 0, 'Counters only run once');
counts.frame(0);
assert.equal(counts.nodes[0].textContent, '0K+');
assert.equal(counts.nodes[3].textContent, '0.00+');
assert.equal(counts.nodes[5].textContent, '1–3 years', 'Ranges must not become false statistics');
assert.equal(counts.nodes[6].textContent, '+0%');
counts.frame(575);
assert.equal(counts.nodes[0].textContent, '36K+');
assert.equal(counts.nodes[3].textContent, '1,094.19+');
counts.frame(1150);
assert.deepEqual(counts.nodes.map(el => el.textContent), counts.values);
assert.equal(counts.frames.size, 0);
counts = setupCounts(); counts.enter(counts.nodes[0]); counts.frame(0);
counts.preference.matches = true; counts.preference.fire('change', { matches: true });
assert.equal(counts.nodes[0].textContent, '41K+'); assert.equal(counts.frames.size, 0); assert(counts.disconnected);
counts = setupCounts(); counts.enter(counts.nodes[1]); counts.frame(0);
counts.d.hidden = true; counts.d.fire('visibilitychange');
assert.equal(counts.nodes[1].textContent, '250+'); assert.equal(counts.frames.size, 0);
assert.equal(setupCounts({ reduced: true }).observed.size, 0);
console.log('UI checks passed: CMS bindings, résumé URLs, horizontal carousel/swipe/keyboard/pause, viewport count-ups, formats and reduced motion.');
