/* GET /api/world-events
   The day's finance-relevant headlines, placed on the map for the homepage
   globe. Reads the public RSS feeds of named publishers and central banks,
   keeps the items that bear on markets (rates, trade, energy, currencies,
   growth, elections, conflict), pins each to the place its headline names,
   and returns at most 24. Headline, publisher, time and link only: nothing
   is rewritten, summarised or attributed to Kakde Research.

   Cached at the edge for 24 hours (s-maxage), so the feeds are read about
   once a day however many visitors arrive. If too few items survive, the
   response says so (`stale: true`) and the page keeps its bundled snapshot.
   No keys, no database, no dependencies. */

'use strict';

const FEEDS = [
  { id: 'bbc', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/business/economics/rss' },
  { id: 'cnbc', name: 'CNBC', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  { id: 'nyt', name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml' },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'et', name: 'The Economic Times', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { id: 'ft', name: 'Financial Times', url: 'https://www.ft.com/world?format=rss' },
  { id: 'fed', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', home: 'washington', official: true },
  { id: 'ecb', name: 'European Central Bank', url: 'https://www.ecb.europa.eu/rss/press.html', home: 'frankfurt', official: true }
];

/* What makes a headline a market event. The first category matched in this
   order names the event; the weights add up to its rank. */
const CATEGORIES = [
  { id: 'central-banks', label: 'Central banks & rates', w: 3, re: /\b(central bank\w*|interest rates?|rate (cut|hike|rise|decision|hold|pause)s?|cuts? rates?|raises? rates?|holds? rates?|federal reserve|fomc|monetary policy|inflation|deflation|consumer prices|bond yields?|treasur(y|ies)|gilts?|quantitative (easing|tightening)|reserve bank|bank of (england|japan|canada|korea|russia)|people'?s bank)\b|\b(Fed|ECB|RBI|PBOC|BoJ|BoE)\b/i },
  { id: 'trade', label: 'Trade & tariffs', w: 3, re: /\b(tariffs?|trade (war|deal|talks|deficit|surplus|pact|agreement|tensions?)|sanctions?|export (ban|controls?|curbs?)|import (ban|dut(y|ies))|WTO|supply chains?|embargo|free[- ]trade)\b/i },
  { id: 'energy', label: 'Energy & commodities', w: 2.5, re: /\b(oil|crude|brent|opec\+?|gas prices?|natural gas|lng|energy (crisis|prices?|bills?)|commodit(y|ies)|gold|copper|iron ore|wheat|rare earths?|lithium|pipeline)\b/i },
  { id: 'markets', label: 'Markets & currencies', w: 2.5, re: /\b(stocks?|shares|equit(y|ies)|stock market|markets? (rally|slump|sell-?off|crash|rout|tumble|surge|plunge)|sell-?off|currency|currencies|rupee|dollar|yen|yuan|renminbi|euro|sterling|pound|peso|lira|rand|ipo|listing|default|debt (crisis|restructuring)|imf|bailout|downgrade|credit rating|sovereign|nifty|sensex|nasdaq|dow|s&p|ftse|nikkei|hang seng|bitcoin)\b/i },
  { id: 'growth', label: 'Growth & policy', w: 2, re: /\b(gdp|recession|economic growth|economy (grows?|shrinks?|slows?|contracts?)|unemployment|jobs (report|data)|payrolls|budget|fiscal|tax(es)?|stimulus|deficit|austerity|spending (cuts?|plans?)|minimum wage|housing market|retail sales|manufacturing|factory (output|activity)|exports?|productivity)\b/i },
  { id: 'conflict', label: 'Conflict & security', w: 2, re: /\b(war|ceasefire|invasion|missiles?|air ?strikes?|blockade|strait of hormuz|red sea|military|troops|drone attacks?|nuclear)\b/i },
  { id: 'politics', label: 'Elections & government', w: 1.5, re: /\b(election|vote|parliament|prime minister|president|government (collapse|falls?|shutdown)|coalition|coup|referendum|cabinet|resign(s|ed|ation)?|impeach\w*)\b/i }
];

/* Places a headline can name. `cs: true` aliases are matched case-sensitively
   (US, UK, Fed) so they do not fire on ordinary words. Cities and
   institutions outrank countries when both appear. */
const P = (key, place, country, lat, lon, aliases, opts) => Object.assign({ key, place, country, lat, lon, aliases }, opts || {});
const PLACES = [
  P('washington', 'Washington, D.C.', 'United States', 38.9, -77.04, ['Washington', 'White House', 'Congress', 'Capitol Hill', 'Federal Reserve', 'IMF', 'World Bank', 'Treasury Department', 'Trump', 'Powell'], { rank: 2, cs: ['Fed', 'FOMC', 'SEC'] }),
  P('newyork', 'New York', 'United States', 40.71, -74.01, ['New York', 'Wall Street', 'Nasdaq', 'S&P 500', 'Dow Jones', 'Manhattan'], { rank: 2, cs: ['NYSE'] }),
  P('sanfrancisco', 'San Francisco', 'United States', 37.77, -122.42, ['Silicon Valley', 'San Francisco', 'Nvidia', 'OpenAI', 'Apple', 'Google', 'Meta', 'Tesla'], { rank: 2 }),
  P('usa', 'United States', 'United States', 39.8, -98.6, ['United States', 'America', 'American'], { rank: 1, cs: ['US', 'U.S.', 'USA'] }),
  P('ottawa', 'Ottawa', 'Canada', 45.42, -75.7, ['Canada', 'Canadian', 'Ottawa', 'Bank of Canada'], { rank: 1 }),
  P('mexico', 'Mexico City', 'Mexico', 19.43, -99.13, ['Mexico', 'Mexican', 'peso'], { rank: 1 }),
  P('brasilia', 'Brasília', 'Brazil', -15.79, -47.88, ['Brazil', 'Brazilian', 'Lula', 'Petrobras'], { rank: 1 }),
  P('buenosaires', 'Buenos Aires', 'Argentina', -34.6, -58.38, ['Argentina', 'Argentine', 'Milei', 'Buenos Aires'], { rank: 1 }),
  P('santiago', 'Santiago', 'Chile', -33.45, -70.67, ['Chile', 'Chilean'], { rank: 1 }),
  P('caracas', 'Caracas', 'Venezuela', 10.48, -66.9, ['Venezuela', 'Venezuelan', 'Caracas'], { rank: 1 }),
  P('bogota', 'Bogotá', 'Colombia', 4.71, -74.07, ['Colombia', 'Colombian'], { rank: 1 }),
  P('london', 'London', 'United Kingdom', 51.51, -0.13, ['London', 'Bank of England', 'Britain', 'British', 'FTSE', 'Downing Street', 'Reeves', 'Starmer', 'gilts', 'sterling'], { rank: 2, cs: ['UK', 'U.K.', 'BoE'] }),
  P('frankfurt', 'Frankfurt', 'Euro area', 50.11, 8.68, ['European Central Bank', 'Frankfurt', 'Lagarde', 'eurozone', 'euro zone', 'euro area', 'Bundesbank'], { rank: 2, cs: ['ECB'] }),
  P('brussels', 'Brussels', 'European Union', 50.85, 4.35, ['Brussels', 'European Union', 'European Commission', 'Europe', 'European'], { rank: 1, cs: ['EU'] }),
  P('berlin', 'Berlin', 'Germany', 52.52, 13.4, ['Germany', 'German', 'Berlin', 'Merz'], { rank: 1 }),
  P('paris', 'Paris', 'France', 48.86, 2.35, ['France', 'French', 'Paris', 'Macron'], { rank: 1 }),
  P('rome', 'Rome', 'Italy', 41.9, 12.5, ['Italy', 'Italian', 'Rome', 'Meloni'], { rank: 1 }),
  P('madrid', 'Madrid', 'Spain', 40.42, -3.7, ['Spain', 'Spanish', 'Madrid'], { rank: 1 }),
  P('zurich', 'Zurich', 'Switzerland', 47.37, 8.54, ['Switzerland', 'Swiss', 'Zurich', 'UBS', 'franc'], { rank: 1 }),
  P('amsterdam', 'Amsterdam', 'Netherlands', 52.37, 4.9, ['Netherlands', 'Dutch', 'ASML'], { rank: 1 }),
  P('stockholm', 'Stockholm', 'Sweden', 59.33, 18.07, ['Sweden', 'Swedish', 'Riksbank'], { rank: 1 }),
  P('oslo', 'Oslo', 'Norway', 59.91, 10.75, ['Norway', 'Norwegian', 'Norges Bank'], { rank: 1 }),
  P('warsaw', 'Warsaw', 'Poland', 52.23, 21.01, ['Poland', 'Polish', 'Warsaw'], { rank: 1 }),
  P('kyiv', 'Kyiv', 'Ukraine', 50.45, 30.52, ['Ukraine', 'Ukrainian', 'Kyiv', 'Zelensky'], { rank: 1 }),
  P('moscow', 'Moscow', 'Russia', 55.76, 37.62, ['Russia', 'Russian', 'Moscow', 'Kremlin', 'Putin', 'rouble', 'ruble'], { rank: 1 }),
  P('ankara', 'Ankara', 'Türkiye', 39.93, 32.86, ['Turkey', 'Turkish', 'Türkiye', 'Erdogan', 'lira', 'Istanbul'], { rank: 1 }),
  P('vienna', 'Vienna', 'OPEC', 48.21, 16.37, ['OPEC', 'OPEC+'], { rank: 2 }),
  P('telaviv', 'Tel Aviv', 'Israel', 32.08, 34.78, ['Israel', 'Israeli', 'Gaza', 'Netanyahu', 'Tel Aviv'], { rank: 1 }),
  P('tehran', 'Tehran', 'Iran', 35.69, 51.39, ['Iran', 'Iranian', 'Tehran', 'Strait of Hormuz', 'Hormuz'], { rank: 1 }),
  P('riyadh', 'Riyadh', 'Saudi Arabia', 24.71, 46.68, ['Saudi', 'Saudi Arabia', 'Riyadh', 'Aramco'], { rank: 1 }),
  P('dubai', 'Dubai', 'United Arab Emirates', 25.2, 55.27, ['Dubai', 'Abu Dhabi', 'Emirates', 'UAE'], { rank: 1 }),
  P('doha', 'Doha', 'Qatar', 25.29, 51.53, ['Qatar', 'Doha'], { rank: 1 }),
  P('cairo', 'Cairo', 'Egypt', 30.04, 31.24, ['Egypt', 'Egyptian', 'Cairo', 'Suez', 'Red Sea'], { rank: 1 }),
  P('lagos', 'Lagos', 'Nigeria', 6.52, 3.38, ['Nigeria', 'Nigerian', 'Lagos', 'naira'], { rank: 1 }),
  P('nairobi', 'Nairobi', 'Kenya', -1.29, 36.82, ['Kenya', 'Kenyan', 'Nairobi'], { rank: 1 }),
  P('johannesburg', 'Johannesburg', 'South Africa', -26.2, 28.05, ['South Africa', 'South African', 'Johannesburg', 'rand'], { rank: 1 }),
  P('addis', 'Addis Ababa', 'Ethiopia', 9.03, 38.74, ['Ethiopia', 'Ethiopian'], { rank: 1 }),
  P('accra', 'Accra', 'Ghana', 5.6, -0.19, ['Ghana', 'Ghanaian'], { rank: 1 }),
  P('mumbai', 'Mumbai', 'India', 19.08, 72.88, ['Mumbai', 'Sensex', 'Nifty', 'Dalal Street', 'Reserve Bank of India', 'rupee', 'Reliance', 'Adani', 'Tata'], { rank: 2, cs: ['RBI', 'SEBI', 'NSE', 'BSE'] }),
  P('delhi', 'New Delhi', 'India', 28.61, 77.21, ['India', 'Indian', 'New Delhi', 'Delhi', 'Modi', 'Sitharaman'], { rank: 1 }),
  P('bengaluru', 'Bengaluru', 'India', 12.97, 77.59, ['Bengaluru', 'Bangalore', 'Infosys', 'Wipro'], { rank: 2 }),
  P('islamabad', 'Islamabad', 'Pakistan', 33.68, 73.05, ['Pakistan', 'Pakistani', 'Islamabad', 'Karachi'], { rank: 1 }),
  P('dhaka', 'Dhaka', 'Bangladesh', 23.81, 90.41, ['Bangladesh', 'Bangladeshi', 'Dhaka'], { rank: 1 }),
  P('colombo', 'Colombo', 'Sri Lanka', 6.93, 79.86, ['Sri Lanka', 'Sri Lankan', 'Colombo'], { rank: 1 }),
  P('beijing', 'Beijing', 'China', 39.9, 116.4, ['China', 'Chinese', 'Beijing', 'Xi Jinping', 'yuan', 'renminbi', "People's Bank of China"], { rank: 1, cs: ['PBOC'] }),
  P('shanghai', 'Shanghai', 'China', 31.23, 121.47, ['Shanghai', 'Shenzhen', 'Alibaba', 'Tencent', 'BYD', 'Evergrande'], { rank: 2 }),
  P('hongkong', 'Hong Kong', 'Hong Kong', 22.32, 114.17, ['Hong Kong', 'Hang Seng'], { rank: 2 }),
  P('taipei', 'Taipei', 'Taiwan', 25.03, 121.57, ['Taiwan', 'Taiwanese', 'Taipei', 'TSMC'], { rank: 1 }),
  P('tokyo', 'Tokyo', 'Japan', 35.68, 139.69, ['Japan', 'Japanese', 'Tokyo', 'Bank of Japan', 'Nikkei', 'yen', 'Toyota', 'SoftBank'], { rank: 1, cs: ['BoJ', 'BOJ'] }),
  P('seoul', 'Seoul', 'South Korea', 37.57, 126.98, ['South Korea', 'Korean', 'Seoul', 'Samsung', 'Kospi', 'won'], { rank: 1 }),
  P('singapore', 'Singapore', 'Singapore', 1.35, 103.82, ['Singapore'], { rank: 2 }),
  P('jakarta', 'Jakarta', 'Indonesia', -6.21, 106.85, ['Indonesia', 'Indonesian', 'Jakarta', 'rupiah'], { rank: 1 }),
  P('hanoi', 'Hanoi', 'Vietnam', 21.03, 105.85, ['Vietnam', 'Vietnamese', 'Hanoi'], { rank: 1 }),
  P('bangkok', 'Bangkok', 'Thailand', 13.76, 100.5, ['Thailand', 'Thai', 'Bangkok', 'baht'], { rank: 1 }),
  P('manila', 'Manila', 'Philippines', 14.6, 120.98, ['Philippines', 'Philippine', 'Manila'], { rank: 1 }),
  P('kualalumpur', 'Kuala Lumpur', 'Malaysia', 3.14, 101.69, ['Malaysia', 'Malaysian', 'ringgit'], { rank: 1 }),
  P('sydney', 'Sydney', 'Australia', -33.87, 151.21, ['Australia', 'Australian', 'Sydney', 'Reserve Bank of Australia', 'Canberra'], { rank: 1, cs: ['RBA'] }),
  P('wellington', 'Wellington', 'New Zealand', -41.29, 174.78, ['New Zealand'], { rank: 1 })
];

/* Stock tips, price tickers and listicles are not events. */
const NOISE = /\b(stock recommendations?|share price (highlights|live|today)|stocks? to (buy|watch)|trading guide|closing above|vwap|price target|top (gainers|losers)|multibagger|horoscope|how to|things to know|live updates?)\b/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const p of PLACES) {
  p.re = new RegExp('(?:^|[^A-Za-z])(' + p.aliases.map(escapeRe).join('|') + ')(?![A-Za-z])', 'i');
  p.reCs = p.cs ? new RegExp('(?:^|[^A-Za-z])(' + p.cs.map(escapeRe).join('|') + ')(?![A-Za-z])') : null;
}
const BY_KEY = Object.fromEntries(PLACES.map((p) => [p.key, p]));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', pound: '£', euro: '€' };
function clean(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m))
    .replace(/\s+/g, ' ').trim();
}

/* A deliberately small RSS reader: <item> blocks, four fields. */
function parseRss(xml) {
  const items = [];
  const blocks = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const pick = (tag) => { const m = b.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i')); return m ? clean(m[1]) : ''; };
    const title = pick('title'); const link = pick('link') || pick('guid');
    if (!title || !/^https:\/\//i.test(link)) continue;
    const when = Date.parse(pick('pubDate') || pick('dc:date'));
    items.push({ title: title.slice(0, 180), link, summary: pick('description').slice(0, 300), at: Number.isFinite(when) ? when : null });
  }
  return items;
}

function classify(text) {
  let score = 0; let first = null;
  for (const c of CATEGORIES) if (c.re.test(text)) { score += c.w; if (!first) first = c; }
  return first ? { category: first.id, label: first.label, score } : null;
}

/* The place a headline names: the best-ranked match, earliest in the title. */
function locate(title, summary, home) {
  const find = (text) => {
    let best = null;
    for (const p of PLACES) {
      const a = p.re.exec(text); const b = p.reCs ? p.reCs.exec(text) : null;
      const idx = Math.min(a ? a.index : Infinity, b ? b.index : Infinity);
      if (idx === Infinity) continue;
      if (!best || p.rank > best.p.rank || (p.rank === best.p.rank && idx < best.idx)) best = { p, idx };
    }
    return best && best.p;
  };
  /* The title decides. Only an institution's own feed falls back to its seat:
     a place named deep in a summary is too often not where the story is. */
  return find(title) || (home && BY_KEY[home]) || null;
}

const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
function similar(a, b) {
  const A = words(a), B = words(b); if (!A.size || !B.size) return false;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) > 0.6;
}

/* Pure: feed items in, ranked and placed events out. */
function buildEvents(feedItems, now, limit) {
  const max = limit || 24; const out = [];
  for (const { feed, item } of feedItems) {
    if (NOISE.test(item.title)) continue;
    const text = item.title + ' ' + item.summary;
    const c = classify(feed.official ? item.title + ' monetary policy' : item.title) || (feed.official ? null : classify(text) && Object.assign(classify(text), { score: classify(text).score * 0.6 }));
    if (!c) continue;
    const ageH = item.at ? (now - item.at) / 36e5 : 36;
    if (ageH > 72 || ageH < -2) continue;
    const place = locate(item.title, item.summary, feed.home);
    if (!place) continue;
    const score = c.score + (ageH <= 24 ? 1.5 : ageH <= 48 ? 0.5 : 0) + (feed.official ? 0.5 : 0);
    if (score < 3) continue;
    out.push({ title: item.title, url: item.link, source: feed.name, publishedAt: item.at ? new Date(item.at).toISOString() : null,
      category: c.category, categoryLabel: c.label, place: place.place, country: place.country, lat: place.lat, lon: place.lon, _key: place.key, _score: score });
  }
  out.sort((a, b) => b._score - a._score || String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const kept = []; const perPlace = {}; const perSource = {};
  for (const e of out) {
    if (kept.length >= max) break;
    if ((perPlace[e._key] || 0) >= 2) continue;
    if ((perSource[e.source] || 0) >= 6) continue;
    if (kept.some((k) => similar(k.title, e.title))) continue;
    perPlace[e._key] = (perPlace[e._key] || 0) + 1; perSource[e.source] = (perSource[e.source] || 0) + 1;
    /* Two events in one city sit side by side rather than on top of each other. */
    if (perPlace[e._key] === 2) { e.lat += 1.6; e.lon += 2.4; }
    kept.push(e);
  }
  const top = kept.length ? kept[0]._score : 1;
  return kept.map((e, i) => {
    const { _key, _score, ...rest } = e;
    return Object.assign({ id: 'e' + (i + 1), weight: _score >= top * 0.8 ? 3 : _score >= top * 0.55 ? 2 : 1 }, rest);
  });
}

async function readFeed(feed, fetchImpl) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetchImpl(feed.url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; feed-reader)', accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!r.ok) return [];
    return parseRss(await r.text()).map((item) => ({ feed, item }));
  } catch (_) { return []; } finally { clearTimeout(t); }
}

const NOTE = 'Headlines are selected and placed automatically from the public feeds of the named publishers. They are not Kakde Research’s views, research or recommendations.';

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: 'Method not allowed.' }));
  }
  const now = Date.now();
  const read = await Promise.all(FEEDS.map((f) => readFeed(f, handler.fetch || fetch)));
  const events = buildEvents(read.flat(), now);
  const live = FEEDS.filter((f, i) => read[i].length).map((f) => f.name);
  const stale = events.length < 6;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  /* A thin day is retried within the hour; a full one stands for a day. */
  res.setHeader('Cache-Control', stale ? 'public, s-maxage=1800' : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=43200');
  res.end(req.method === 'HEAD' ? '' : JSON.stringify({ ok: true, stale, generatedAt: new Date(now).toISOString(), windowHours: 72, sources: live, note: NOTE, events }));
}

module.exports = handler;
module.exports.parseRss = parseRss;
module.exports.classify = classify;
module.exports.locate = locate;
module.exports.buildEvents = buildEvents;
module.exports.FEEDS = FEEDS;
