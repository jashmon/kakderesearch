// Builds assets/data/world-borders.json: every country boundary and coastline for the homepage globe.
//
// Source: Natural Earth 1:10m "Admin 0 - Countries", India point-of-view edition
// (ne_10m_admin_0_countries_ind, public domain). That edition draws the world as India's official maps do:
// the whole of Jammu & Kashmir and Ladakh (including Gilgit-Baltistan, the Shaksgam valley and Aksai Chin)
// and Arunachal Pradesh lie inside India, and no disputed or line-of-control boundaries are drawn.
//
// Usage: node tools/globe/make-borders.mjs   (needs network access once, and npx for mapshaper)
import { execFileSync } from "node:child_process"; import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const T = join(tmpdir(), "kakde-borders"); mkdirSync(T, { recursive: true });
const src = join(T, "ind.geojson");
if (!existsSync(src)) execFileSync("curl", ["-sL", "-m", "300", "-o", src, "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson"]);
const ms = (...a) => execFileSync("npx", ["-y", "mapshaper@0.6.102", ...a], { stdio: "ignore" });
// One topology-preserving simplification, so neighbours keep sharing the same vertices; Antarctica is off the map.
ms(src, "-filter", 'ADM0_A3 != "ATA"', "-filter-islands", "min-area=500km2", "-simplify", "dp", "10%", "keep-shapes", "-o", "precision=0.01", join(T, "world.geojson"));
ms(join(T, "world.geojson"), "-lines", "-o", "precision=0.01", join(T, "lines.geojson"));
ms(join(T, "world.geojson"), "-filter", 'ADM0_A3 == "IND"', "-o", "precision=0.01", join(T, "india.geojson"));
const L = JSON.parse(readFileSync(join(T, "lines.geojson"))), I = JSON.parse(readFileSync(join(T, "india.geojson")));
const enc = (l) => { const o = []; let px = 0, py = 0; for (const [x, y] of l) { const X = Math.round(x * 100), Y = Math.round(y * 100); o.push(X - px, Y - py); px = X; py = Y; } return o; };
const borders = [], coasts = [];
for (const f of L.features) { const g = f.geometry; for (const l of g.type === "LineString" ? [g.coordinates] : g.coordinates) (f.properties.TYPE === "inner" ? borders : coasts).push(enc(l)); }
const ig = I.features[0].geometry; const india = (ig.type === "Polygon" ? [ig.coordinates] : ig.coordinates).map((p) => enc(p[0]));
// Guard: the places that must be inside India in this edition.
const ring = (e) => { const r = []; let x = 0, y = 0; for (let i = 0; i < e.length; i += 2) { x += e[i]; y += e[i + 1]; r.push([x / 100, y / 100]); } return r; };
const inside = (pt, r) => { let c = false; for (let i = 0, k = r.length - 1; i < r.length; k = i++) { const [xi, yi] = r[i], [xj, yj] = r[k]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const rings = india.map(ring);
for (const [name, pt] of Object.entries({ Srinagar: [74.8, 34.08], Leh: [77.58, 34.15], Gilgit: [74.31, 35.92], Muzaffarabad: [73.47, 34.37], Skardu: [75.63, 35.3], "Aksai Chin": [79.5, 35.2], "Shaksgam valley": [76.4, 36.1], Itanagar: [93.6, 27.1] }))
  if (!rings.some((r) => inside(pt, r))) throw new Error(`${name} is not inside India in the source data; do not publish this file`);
const out = { source: "Natural Earth 1:10m Admin 0 Countries, India point-of-view edition (public domain); simplified with mapshaper", built: new Date().toISOString().slice(0, 10),
  encoding: "each line is [dlon, dlat, ...] in hundredths of a degree, delta-coded from 0,0", borders, coasts, india };
writeFileSync("assets/data/world-borders.json", JSON.stringify(out));
console.log(`world-borders.json: ${borders.length} borders, ${coasts.length} coasts, ${india.length} India rings, ${(JSON.stringify(out).length / 1024) | 0} KB; India checks passed`);
