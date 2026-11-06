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
assert(!html.includes('SAMPLE:'));
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
  const carousel = element(), slides = Array.from({ length: count }, element);
  const controls = Object.fromEntries(['prev', 'next', 'toggle', 'status', 'controls'].map(k => [k, element()]));
  controls.controls.hidden = true;
  carousel.dataset.autoplay = String(autoplay);
  carousel.querySelectorAll = () => slides;
  carousel.querySelector = selector => controls[selector.replace('[data-carousel-', '').replace(']', '')];
  const d = { ...element(), hidden: false, querySelectorAll: () => [carousel] };
  const preference = { ...element(), matches: reduced };
  const timers = new Map(); let id = 0;
  vm.runInNewContext(carouselCode, { d, motionPreference: preference, animate() {},
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); } });
  return { carousel, slides, controls, d, preference, timers,
    tick() { const [key, fn] = timers.entries().next().value; timers.delete(key); fn(); } };
}
let c = setup();
assert.equal(c.slides[1].hidden, true);
c.tick(); assert.equal(c.slides[0].hidden, true);
c.tick(); assert.equal(c.slides[1].hidden, true);
c.carousel.fire('pointerenter'); assert.equal(c.timers.size, 0);
c.carousel.fire('pointerleave'); assert.equal(c.timers.size, 1);
c.carousel.fire('focusin', { target: c.controls.next }); assert.equal(c.timers.size, 0);
c.controls.prev.fire('click'); assert.equal(c.controls.status.textContent, '2 / 2');
assert.equal(c.controls.status.attributes['aria-live'], 'polite');
c.controls.toggle.fire('click'); assert.equal(c.timers.size, 1);
c.controls.toggle.fire('pointerdown');
c.carousel.fire('focusin', { target: c.controls.toggle });
assert.equal(c.timers.size, 0);
c.controls.toggle.fire('click', { detail: 1 }); assert.equal(c.timers.size, 0);
c.controls.toggle.fire('click'); assert.equal(c.timers.size, 1);
c.d.hidden = true; c.d.fire('visibilitychange'); assert.equal(c.timers.size, 0);
c.d.hidden = false; c.d.fire('visibilitychange'); assert.equal(c.timers.size, 1);
c.preference.matches = true; c.preference.fire('change'); assert.equal(c.timers.size, 0);
assert.equal(c.controls.toggle.disabled, true);
assert.equal(setup({ count: 1 }).controls.controls.hidden, true);
assert.equal(setup({ reduced: true }).timers.size, 0);
assert.equal(setup({ autoplay: false }).timers.size, 0);
console.log('UI checks passed: content/CMS bindings, résumé URLs, carousel rotation, wrap, pause, focus and reduced motion.');
