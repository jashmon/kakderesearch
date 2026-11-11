/* Wires the globe to the page: loads the day's events (the API, then the
   bundled snapshot), fills the list, and keeps the card, the list and the
   globe pointing at the same event. The list is the accessible control;
   the globe is the picture of it. */
import { createGlobe } from './globe.js';

const root = document.querySelector('[data-globe]');
if (root) init();

async function load() {
  const get = async (url) => { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(r.status); return r.json(); };
  try { const live = await get('/api/world-events/'); if (live && live.events && live.events.length >= 6) return live; } catch (_) { /* fall through */ }
  return get(root.dataset.snapshot || 'assets/data/world-events.json');
}

const ago = (iso) => {
  if (!iso) return ''; const h = Math.max(0, (Date.now() - Date.parse(iso)) / 36e5);
  return h < 1 ? 'Under an hour ago' : h < 24 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago';
};
const utc = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

async function init() {
  const stage = root.querySelector('[data-globe-stage]');
  const card = root.querySelector('[data-globe-card]');
  const list = root.querySelector('[data-globe-list]');
  const filters = root.querySelector('[data-globe-filters]');
  const stamp = root.querySelector('[data-globe-stamp]');
  const live = root.querySelector('[data-globe-live]');

  let data;
  try { data = await load(); } catch (_) { root.classList.add('is-empty'); return; }
  let events = data.events; let current = null; let pinned = false; let tour = null; let tourAt = 0;

  const globe = createGlobe(stage, {
    assets: root.dataset.assets || 'assets/globe/',
    onHover(e) { if (pinned) return; if (e) show(e.id, { from: 'globe' }); else hide(); },
    onSelect(e) { pinned = true; show(e.id, { from: 'globe', pin: true }); },
    onFrame() { place(); }
  });
  if (!globe) root.classList.add('no-webgl');

  stamp.textContent = `${events.length} events · updated ${utc(data.generatedAt)}`;
  if (window.matchMedia('(hover: none)').matches) root.querySelector('.globe-hint').textContent = 'Tap a point · drag to turn';
  root.querySelector('[data-globe-sources]').textContent = 'Headlines: ' + data.sources.join(', ') + '.';

  /* filters: one chip per category present */
  const cats = [...new Map(events.map((e) => [e.category, e.categoryLabel])).entries()];
  let filter = 'all';
  const chip = (id, label) => { const b = el('button', 'globe-chip', label); b.type = 'button'; b.setAttribute('aria-pressed', String(id === filter)); b.addEventListener('click', () => { filter = id; render(); }); return b; };

  function render() {
    filters.replaceChildren(chip('all', 'All'), ...cats.map(([id, label]) => chip(id, label)));
    const shown = events.filter((e) => filter === 'all' || e.category === filter);
    list.replaceChildren(...shown.map((e) => {
      const li = el('li'); const b = el('button', 'globe-item'); b.type = 'button'; b.dataset.id = e.id;
      b.append(el('span', 'globe-item-place', e.place), el('span', 'globe-item-title', e.title), el('span', 'globe-item-meta', `${e.categoryLabel} · ${e.source} · ${ago(e.publishedAt)}`));
      b.addEventListener('mouseenter', () => { if (!pinned) show(e.id, { from: 'list' }); });
      b.addEventListener('focus', () => show(e.id, { from: 'list' }));
      b.addEventListener('click', () => { pinned = true; show(e.id, { from: 'list', pin: true }); });
      li.append(b); return li;
    }));
    if (globe) globe.setEvents(shown);
    hide(); pinned = false;
  }

  function show(id, { from, pin } = {}) {
    const e = events.find((x) => x.id === id); if (!e) return;
    current = id; tourAt = performance.now();
    if (globe) { globe.setActive(id); if (from !== 'globe' || pin) globe.face(id, true); }
    card.querySelector('[data-c-place]').textContent = `${e.place} · ${e.categoryLabel}`;
    card.querySelector('[data-c-title]').textContent = e.title;
    card.querySelector('[data-c-meta]').textContent = `${e.source} · ${ago(e.publishedAt)}`;
    const a = card.querySelector('[data-c-link]'); a.href = e.url; a.hidden = !pin && from === 'globe' ? false : false;
    card.hidden = false; card.classList.toggle('is-pinned', !!pin);
    list.querySelectorAll('.globe-item').forEach((b) => b.classList.toggle('is-active', b.dataset.id === id));
    if (from === 'globe') { const b = list.querySelector(`[data-id="${id}"]`); if (b && pin) b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    if (pin) live.textContent = `${e.place}: ${e.title}. ${e.source}.`;
  }
  function hide() {
    current = null; card.hidden = true; if (globe) { globe.setActive(null); globe.release(); }
    list.querySelectorAll('.is-active').forEach((b) => b.classList.remove('is-active'));
  }
  /* the card follows its marker on wide screens; on narrow ones CSS docks it */
  function place() {
    if (card.hidden || !current || !globe) return;
    const s = globe.screenOf(current); if (!s) return;
    const w = stage.clientWidth, cw = card.offsetWidth, ch = card.offsetHeight;
    const right = s.x < w * 0.55; const x = right ? s.x + 22 : s.x - cw - 22; const y = Math.max(8, Math.min(stage.clientHeight - ch - 8, s.y - ch / 2));
    card.style.setProperty('--x', Math.max(8, Math.min(w - cw - 8, x)) + 'px'); card.style.setProperty('--y', y + 'px');
    card.classList.toggle('is-behind', !s.visible);
  }

  card.querySelector('[data-c-close]').addEventListener('click', () => { pinned = false; hide(); });
  root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { pinned = false; hide(); } });
  list.addEventListener('mouseleave', () => { if (!pinned) hide(); });
  list.addEventListener('focusout', (ev) => { if (!pinned && !list.contains(ev.relatedTarget)) hide(); });

  render();

  /* A quiet tour: when nobody is touching it, the globe visits the leading
     events in turn. Any input stops it; reduced motion never starts it. */
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (globe && !reduce) {
    let i = 0; let touched = 0;
    const touch = () => { touched = performance.now(); };
    ['pointermove', 'pointerdown', 'keydown', 'focusin', 'wheel', 'touchstart'].forEach((t) => root.addEventListener(t, touch, { passive: true }));
    tour = setInterval(() => {
      if (pinned || document.hidden || performance.now() - touched < 9000) return;
      const shown = events.filter((e) => filter === 'all' || e.category === filter).slice(0, 8); if (!shown.length) return;
      show(shown[i++ % shown.length].id, { from: 'tour' });
    }, 5200);
  }
}
