/* The globe's event feed: parsing, selection and placement, with the network stubbed. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/world-events.js');

const now = Date.parse('2026-11-12T06:00:00Z');
const rss = (items, base = now) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title><![CDATA[${i.t}]]></title><link>${i.l || 'https://example.org/a'}</link><pubDate>${new Date(base - (i.h || 2) * 36e5).toUTCString()}</pubDate><description>${i.d || ''}</description></item>`).join('')}</channel></rss>`;
const res = () => ({ statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b || ''); } });

test('parseRss reads title, link and date and drops items without an https link', () => {
  const items = handler.parseRss(rss([{ t: 'RBI holds rates &amp; flags inflation' }, { t: 'No link', l: 'javascript:alert(1)' }]));
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'RBI holds rates & flags inflation');
});

test('classify keeps market events and ignores ordinary news', () => {
  assert.equal(handler.classify('ECB cuts rates as inflation cools').category, 'central-banks');
  assert.equal(handler.classify('Tariffs on steel imports doubled').category, 'trade');
  assert.equal(handler.classify('Local team wins the cup final'), null);
});

test('locate prefers the institution or city named in the title', () => {
  assert.equal(handler.locate('RBI holds rates as rupee steadies', '').place, 'Mumbai');
  assert.equal(handler.locate('US inflation rises more than expected', '').country, 'United States');
  assert.equal(handler.locate('A headline that names nowhere', 'Summary mentions Tehran'), null);
});

test('buildEvents ranks, places and removes near-duplicates and stock tips', () => {
  const feed = { name: 'Test Wire' };
  const mk = (t, h) => ({ feed, item: { title: t, link: 'https://example.org/' + encodeURIComponent(t), summary: '', at: now - (h || 2) * 36e5 } });
  const ev = handler.buildEvents([
    mk('Bank of Japan raises interest rates for the first time this year'),
    mk('Bank of Japan raises interest rates for first time this year, yen jumps'),
    mk('Wipro Share Price Highlights: stock price history'),
    mk('China imposes export controls on rare earths as trade talks stall'),
    mk('Old news: Brazil central bank holds rates', 200)
  ], now);
  assert.equal(ev.length, 2);
  assert.deepEqual(ev.map((e) => e.place).sort(), ['Beijing', 'Tokyo']);
  for (const e of ev) { assert.ok(e.lat >= -90 && e.lat <= 90); assert.ok(/^https:\/\//.test(e.url)); assert.ok([1, 2, 3].includes(e.weight)); }
});

test('the handler caches a full day for a day and marks a thin one stale', async () => {
  const many = ['Fed holds rates', 'ECB cuts rates', 'Bank of England raises rates', 'RBI holds rates as rupee slips', 'China tariffs hit exports', 'Saudi oil output rises', 'Germany GDP shrinks', 'Brazil inflation jumps'];
  handler.fetch = async () => ({ ok: true, text: async () => rss(many.map((t, i) => ({ t, l: 'https://example.org/' + i })), Date.now()) });
  const full = res(); await handler({ method: 'GET' }, full);
  const body = JSON.parse(full.body);
  assert.equal(full.statusCode, 200); assert.equal(body.stale, false); assert.ok(body.events.length >= 6);
  assert.match(full.headers['cache-control'], /s-maxage=86400/);
  handler.fetch = async () => { throw new Error('offline'); };
  const thin = res(); await handler({ method: 'GET' }, thin);
  assert.equal(JSON.parse(thin.body).stale, true); assert.match(thin.headers['cache-control'], /s-maxage=1800/);
  const post = res(); await handler({ method: 'POST' }, post); assert.equal(post.statusCode, 405);
  delete handler.fetch;
});
