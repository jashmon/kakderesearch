// Builds the two rasters the homepage globe needs, from the same Natural Earth data as the borders
// (1:10m Admin 0 Countries, India point-of-view edition, public domain):
//
//   assets/img/globe-land.png   4096 x 2048 greyscale land mask (white land, black sea), equirectangular,
//                               antialiased; the shader colours land and sea from it.
//   assets/data/sea-grid.json   720 x 360 (half-degree) grid of the open ocean the ship may sail, with the
//                               shipping canals and straits that are too narrow for the grid opened by hand,
//                               and enclosed water (the Caspian, the Great Lakes) removed.
//
// Usage: node tools/globe/make-land.mjs
// Needs: network once (the Natural Earth file), npx (mapshaper), and Playwright + pngjs, taken from the
// visual-copy skill's install (~/.claude/skills/visual-copy/scripts/node_modules) or VISUAL_COPY_SCRIPTS.
import { execFileSync } from "node:child_process"; import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module"; import { homedir, tmpdir } from "node:os"; import { join } from "node:path";
const T = join(tmpdir(), "kakde-borders"); mkdirSync(T, { recursive: true });
const src = join(T, "ind.geojson");
if (!existsSync(src)) execFileSync("curl", ["-sL", "-m", "300", "-o", src, "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson"]);
execFileSync("npx", ["-y", "mapshaper@0.6.102", src, "-filter-islands", "min-area=60km2", "-simplify", "dp", "14%", "keep-shapes", "-dissolve", "-o", "precision=0.01", join(T, "land.geojson")], { stdio: "ignore" });
const land = JSON.parse(readFileSync(join(T, "land.geojson"), "utf8"));
const geoms = land.features ? land.features.map((f) => f.geometry) : land.geometries || [land];
const polys = []; for (const g of geoms) { for (const p of g.type === "Polygon" ? [g.coordinates] : g.coordinates) polys.push(p); }

const VC = process.env.VISUAL_COPY_SCRIPTS || join(homedir(), ".claude/skills/visual-copy/scripts");
const req = createRequire(join(VC, "package.json"));
const { chromium } = req("playwright"); const { PNG } = req("pngjs");

const browser = await chromium.launch(); const page = await browser.newPage();
const raster = (W, H) => page.evaluate(({ polys, W, H }) => {
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  x.fillStyle = "#000"; x.fillRect(0, 0, W, H); x.fillStyle = "#fff"; x.beginPath();
  for (const p of polys) for (const ring of p) { ring.forEach(([lon, lat], i) => { const X = ((lon + 180) / 360) * W, Y = ((90 - lat) / 180) * H; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }); x.closePath(); }
  x.fill("evenodd");
  const d = x.getImageData(0, 0, W, H).data; const out = new Array(W * H); for (let i = 0; i < W * H; i++) out[i] = d[i * 4];
  return out;
}, { polys, W, H });

// 1. the land mask
const W = 4096, H = 2048, mask = await raster(W, H);
const png = new PNG({ width: W, height: H, colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
png.data = Buffer.from(mask);
writeFileSync("assets/img/globe-land.png", PNG.sync.write(png, { colorType: 0, inputColorType: 0, inputHasAlpha: false }));

// 2. the sea grid
const GW = 720, GH = 360, g = await raster(GW, GH); await browser.close();
const sea = new Uint8Array(GW * GH); for (let i = 0; i < GW * GH; i++) sea[i] = g[i] < 128 ? 1 : 0;
const cell = (lon, lat) => [Math.max(0, Math.min(GW - 1, Math.floor(((lon + 180) / 360) * GW))), Math.max(0, Math.min(GH - 1, Math.floor(((90 - lat) / 180) * GH)))];
// Waterways narrower than half a degree, opened along their real line: [name, [lon, lat], [lon, lat], ...]
const CHANNELS = [
  ["Gulf of Suez and Suez Canal", [34.2, 27.6], [33.6, 28.3], [32.9, 29.3], [32.57, 29.93], [32.55, 30.6], [32.33, 31.27], [32.3, 31.6]],
  ["Panama Canal", [-79.92, 9.6], [-79.92, 9.38], [-79.7, 9.1], [-79.55, 8.88], [-79.5, 8.6]],
  ["Strait of Gibraltar", [-6.4, 35.95], [-5.6, 35.97], [-4.9, 36.1]],
  ["Dardanelles and Bosphorus", [26.0, 40.0], [26.6, 40.3], [27.5, 40.7], [28.95, 40.95], [29.1, 41.25], [29.3, 41.6]],
  ["Danish straits", [10.8, 57.6], [11.4, 56.6], [12.65, 56.05], [12.7, 55.5], [13.2, 55.2]],
  ["Strait of Dover", [1.0, 50.3], [1.45, 51.0], [2.0, 51.4]],
  ["Bab-el-Mandeb", [43.0, 13.2], [43.4, 12.6], [43.6, 12.2]],
  ["Strait of Hormuz", [56.0, 26.0], [56.4, 26.5], [56.9, 26.3]],
  ["Strait of Malacca and Singapore Strait", [100.0, 3.5], [101.5, 2.4], [103.4, 1.2], [104.3, 1.25]],
  ["Strait of Messina", [15.6, 37.9], [15.65, 38.3]],
];
for (const [, ...pts] of CHANNELS) for (let k = 1; k < pts.length; k++) {
  const [a, b] = [pts[k - 1], pts[k]]; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1) + 1;
  for (let s = 0; s <= n; s++) { const [i, j] = cell(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n); sea[j * GW + i] = 1; }
}
// keep only the largest connected body of water (8-connected, wrapping east-west)
const comp = new Int32Array(GW * GH).fill(-1); let best = -1, bestN = 0;
for (let s = 0, id = 0; s < GW * GH; s++) {
  if (!sea[s] || comp[s] >= 0) continue; const stack = [s]; comp[s] = id; let n = 0;
  while (stack.length) { const c = stack.pop(); n++; const ci = c % GW, cj = (c / GW) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const nj = cj + dj; if (nj < 0 || nj >= GH) continue; const nn = nj * GW + ((ci + di + GW) % GW); if (sea[nn] && comp[nn] < 0) { comp[nn] = id; stack.push(nn); } } }
  if (n > bestN) { bestN = n; best = id; } id++;
}
const bits = new Uint8Array(Math.ceil((GW * GH) / 8)); let open = 0;
for (let s = 0; s < GW * GH; s++) if (comp[s] === best) { bits[s >> 3] |= 1 << (s & 7); open++; }
// Guard: these must be open ocean, or the ship could not reach the places it docks at.
const isOpen = (lon, lat) => { const [i, j] = cell(lon, lat); return comp[j * GW + i] === best; };
for (const [name, lon, lat] of [["Suez Canal", 32.55, 30.6], ["Gulf of Suez", 33.0, 29.0], ["Red Sea", 36.5, 24], ["Eastern Mediterranean", 32.5, 32.5], ["Panama Canal", -79.7, 9.1], ["Gibraltar", -5.6, 35.97], ["Arabian Sea off Mumbai", 71.5, 18.5], ["Persian Gulf", 52, 26.5], ["Baltic", 18, 56], ["Mediterranean", 18, 35], ["Bay of Bengal", 88, 15], ["South China Sea", 115, 15]])
  if (!isOpen(lon, lat)) throw new Error(`${name} is not open ocean in the sea grid`);
if (isOpen(51, 42)) throw new Error("the Caspian Sea is connected to the ocean in the sea grid");
writeFileSync("assets/data/sea-grid.json", JSON.stringify({ source: "Natural Earth 1:10m Admin 0 Countries, India point-of-view edition (public domain); rasterised by tools/globe/make-land.mjs",
  built: new Date().toISOString().slice(0, 10), width: GW, height: GH, cellDegrees: 0.5, order: "row-major from 90N, 180W; bit s of byte s>>3 is 1 for open ocean",
  channels: CHANNELS.map((c) => c[0]), bits: Buffer.from(bits).toString("base64") }));
console.log(`globe-land.png ${W}x${H}; sea-grid.json ${GW}x${GH}, ${open} open-ocean cells; guards passed`);
