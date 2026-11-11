/* Wires the globe to the page.

   - Loads the day's events (the API, then the bundled snapshot) and shows
     one at a time in the event bar, with previous / next and a full list.
   - Keeps the bar, the hover card and the globe on the same event.
   - Maps the scroll through the scene to the camera: whole globe with
     events in the hero, then closing in on India with the financial
     centres as the "Where the work is" panel arrives.
   - On narrow screens the globe is not pinned; the stage is moved between
     a slot under the hero, and zooms as that slot travels up the screen. */
import { createGlobe } from './globe.js';

const root = document.querySelector('[data-globe]');

const BASE = { id: 'base', name: 'Mumbai, India', lat: 19.08, lon: 72.88 };
/* the twenty leading financial centres named on the page */
const CENTRES = [['New York', 40.71, -74.01], ['London', 51.51, -0.13], ['Hong Kong', 22.32, 114.17], ['Singapore', 1.35, 103.82], ['San Francisco', 37.77, -122.42], ['Shanghai', 31.23, 121.47], ['Dubai', 25.2, 55.27], ['Seoul', 37.57, 126.98], ['Shenzhen', 22.54, 114.06], ['Tokyo', 35.68, 139.69], ['Zurich', 47.37, 8.54], ['Los Angeles', 34.05, -118.24], ['Boston', 42.36, -71.06], ['Chicago', 41.88, -87.63], ['Frankfurt', 50.11, 8.68], ['Luxembourg', 49.61, 6.13], ['Washington, D.C.', 38.9, -77.04], ['Geneva', 46.2, 6.14], ['Paris', 48.86, 2.35], ['Amsterdam', 52.37, 4.9]]
  .map(([name, lat, lon], i) => ({ id: 'c' + i, name, lat, lon }));

async function load() {
  const get = async (url) => { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(r.status); return r.json(); };
  try { const live = await get('/api/world-events/'); if (live && live.events && live.events.length >= 6) return live; } catch (_) { /* fall through */ }
  return get(root.dataset.snapshot);
}
const ago = (iso) => { if (!iso) return ''; const h = Math.max(0, (Date.now() - Date.parse(iso)) / 36e5); return h < 1 ? 'Under an hour ago' : h < 24 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; };
const utc = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const $ = (sel) => root.querySelector(sel);

async function init() {
  const stage = $('[data-globe-stage]'), card = $('[data-globe-card]'), tip = $('[data-globe-tip]'), bar = $('[data-globe-bar]');
  const list = $('[data-globe-list]'), live = $('[data-globe-live]'), sticky = $('.globe-sticky');
  const heroPanel = $('.globe-panel.is-hero'), workPanel = $('.globe-panel.is-work');
  const slots = { hero: $('[data-globe-slot="hero"]') };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wide = window.matchMedia('(min-width: 961px)');

  let events = [], current = null, index = 0, pinned = false, mode = 'hero', touched = 0;

  const globe = createGlobe(stage, {
    land: root.dataset.land,
    onHover(e) {
      if (e && e.kind) { tip.textContent = e.name; tip.hidden = false; tipFor = e.id; return; }
      tip.hidden = true; tipFor = null;
      if (mode !== 'hero' || pinned) return;
      if (e) show(e.id, { from: 'globe' }); else card.hidden = true;
    },
    onSelect(e) { if (e.kind) return; pinned = true; show(e.id, { from: 'globe', pin: true }); },
    onFrame() { place(); },
    onZoom(z) { root.classList.toggle('is-zoomed', z > 0.02); }
  });
  if (!globe) { root.classList.add('no-webgl'); }
  else { root.classList.add('has-webgl'); globe.setCentres(BASE, CENTRES); }
  let tipFor = null;

  /* ----- zoom controls ----- */
  root.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    if (!globe) return; const k = b.dataset.zoom;
    if (k === 'in') globe.zoomBy(0.25); else if (k === 'out') globe.zoomBy(-0.25); else { globe.resetView(); pinned = false; card.hidden = true; }
  }));

  /* ----- events ----- */
  let data = null;
  try { data = await load(); } catch (_) { /* no events: the globe and the second panel still work */ }
  if (data && data.events && data.events.length) {
    events = data.events;
    if (globe) globe.setEvents(events);
    $('[data-globe-stamp]').textContent = 'Updated ' + utc(data.generatedAt);
    $('[data-globe-sources]').textContent = data.sources.join(', ') + '.';
    $('[data-globe-count]').textContent = String(events.length);
    list.replaceChildren(...events.map((e, i) => {
      const li = el('li'); const b = el('button', 'globe-item'); b.type = 'button'; b.dataset.id = e.id;
      b.append(el('span', 'globe-item-place', e.place), el('span', 'globe-item-title', e.title), el('span', 'globe-item-meta', `${e.source} · ${ago(e.publishedAt)}`));
      b.addEventListener('click', () => { pinned = true; index = i; show(e.id, { from: 'list', pin: true }); });
      li.append(b); return li;
    }));
    bar.hidden = false; show(events[0].id, { from: 'tour' });
  } else { bar.hidden = true; }

  function show(id, { from, pin } = {}) {
    const e = events.find((x) => x.id === id); if (!e) return;
    current = id; index = events.indexOf(e);
    if (globe) { globe.setActive(id); if (from !== 'globe') globe.face(id, !!pin || from === 'list' || from === 'step'); }
    const meta = `${e.source} · ${ago(e.publishedAt)}`;
    bar.querySelector('[data-b-place]').textContent = `${e.place} · ${e.categoryLabel}`;
    bar.querySelector('[data-b-title]').textContent = e.title;
    bar.querySelector('[data-b-meta]').textContent = meta;
    bar.querySelector('[data-b-link]').href = e.url;
    bar.querySelector('[data-b-pos]').textContent = `${index + 1} / ${events.length}`;
    card.querySelector('[data-c-place]').textContent = e.place;
    card.querySelector('[data-c-title]').textContent = e.title;
    card.querySelector('[data-c-meta]').textContent = meta;
    card.hidden = !(from === 'globe' && wide.matches);
    list.querySelectorAll('.globe-item').forEach((b) => b.classList.toggle('is-active', b.dataset.id === id));
    if (pin || from === 'step') live.textContent = `${e.place}: ${e.title}. ${e.source}.`;
  }
  const step = (d) => { if (!events.length) return; pinned = true; index = (index + d + events.length) % events.length; show(events[index].id, { from: 'step' }); };
  bar.querySelector('[data-b-prev]').addEventListener('click', () => step(-1));
  bar.querySelector('[data-b-next]').addEventListener('click', () => step(1));

  /* the hover card and the centre label follow their points */
  function place() {
    if (!globe) return;
    if (!card.hidden && current) {
      const s = globe.screenOf(current);
      if (s) { const w = stage.clientWidth, cw = card.offsetWidth, ch = card.offsetHeight; const right = s.x < w * 0.62;
        card.style.setProperty('--x', Math.max(8, Math.min(w - cw - 8, right ? s.x + 20 : s.x - cw - 20)) + 'px');
        card.style.setProperty('--y', Math.max(8, Math.min(stage.clientHeight - ch - 8, s.y - ch / 2)) + 'px');
        card.classList.toggle('is-behind', !s.visible); }
    }
    if (!tip.hidden && tipFor) { const s = globe.screenOf(tipFor); if (s) { tip.style.setProperty('--x', s.x + 'px'); tip.style.setProperty('--y', (s.y - 16) + 'px'); } }
  }

  /* ----- the scene: scroll position to camera ----- */
  const ease = (t) => t * t * (3 - 2 * t);
  function setMode(next) {
    if (next === mode) return; mode = next; root.dataset.mode = next;
    if (next === 'work') { card.hidden = true; pinned = false; if (globe) globe.setActive(null); }
    else if (globe && current) globe.setActive(current);
  }
  let looking = false;
  function sync() {
    if (!globe) return;
    if (wide.matches) {
      if (stage.parentNode !== sticky) sticky.append(stage);
      const span = heroPanel.offsetHeight || 1; const t = Math.max(0, Math.min(1, -heroPanel.getBoundingClientRect().top / span));
      const p = ease(Math.max(0, Math.min(1, (t - 0.12) / 0.78)));
      const look = p > 0.04;
      globe.setScene({ zoom: p * 0.6, mix: p, shiftX: 0.21, look: look ? { lat: BASE.lat + 6, lon: BASE.lon + 4 } : null, release: looking && !look }); looking = look;
      setMode(p > 0.5 ? 'work' : 'hero');
    } else {
      /* narrow screens: nothing is pinned. The globe sits between the hero and "Where the work is",
         and closes in on India as it travels up the screen, so it arrives at that heading zoomed in. */
      if (stage.parentNode !== slots.hero) slots.hero.append(stage);
      const top = slots.hero.getBoundingClientRect().top, span = window.innerHeight * 0.42;
      const p = ease(Math.max(0, Math.min(1, (span - top) / span)));
      const look = p > 0.04;
      globe.setScene({ zoom: p * 0.6, mix: p, shiftX: 0, look: look ? { lat: BASE.lat + 4, lon: BASE.lon } : null, release: looking && !look }); looking = look;
      setMode(p > 0.5 ? 'work' : 'hero');
    }
  }
  let queued = false; const queue = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } };
  window.addEventListener('scroll', queue, { passive: true }); window.addEventListener('resize', queue); wide.addEventListener('change', queue);
  sync();

  root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { pinned = false; card.hidden = true; } });
  ['pointermove', 'pointerdown', 'keydown', 'focusin', 'touchstart'].forEach((t) => root.addEventListener(t, () => { touched = performance.now(); }, { passive: true }));

  /* A quiet tour of the events while nobody is touching it. Reduced motion never starts it. */
  if (globe && !reduce) setInterval(() => {
    if (mode !== 'hero' || pinned || document.hidden || !events.length || performance.now() - touched < 9000) return;
    if (root.getBoundingClientRect().top < -80) return;
    index = (index + 1) % Math.min(events.length, 8); show(events[index].id, { from: 'tour' });
  }, 5600);
}

if (root) init();
