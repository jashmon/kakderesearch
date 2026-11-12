/* Sea routes for the globe's cargo ship.

   assets/data/sea-grid.json is a half-degree grid of open ocean (built by
   tools/globe/make-land.mjs, with the Suez and Panama canals and the narrow
   straits opened). A route is an A* search over that grid, kept a cell off
   the coast where it can be, then straightened into legs of open water.
   Places inland dock at the nearest open-ocean cell: Frankfurt at the North
   Sea, Tehran in the Gulf. */

export function createSeaRouter(grid) {
  const W = grid.width, H = grid.height, D = grid.cellDegrees, N = W * H;
  const raw = atob(grid.bits), open = new Uint8Array(N);
  for (let s = 0; s < N; s++) open[s] = (raw.charCodeAt(s >> 3) >> (s & 7)) & 1;
  const lonOf = (i) => -180 + (i + 0.5) * D, latOf = (j) => 90 - (j + 0.5) * D;
  const cosRow = new Float32Array(H); for (let j = 0; j < H; j++) cosRow[j] = Math.max(0.05, Math.cos(latOf(j) * Math.PI / 180));
  const wrap = (i) => ((i % W) + W) % W;
  /* a cell next to land costs more, so routes stand off the coast */
  const coastal = new Uint8Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const s = j * W + i; if (!open[s]) continue;
    for (let dj = -1; dj <= 1 && !coastal[s]; dj++) for (let di = -1; di <= 1; di++) { const nj = j + dj; if (nj < 0 || nj >= H) continue; if (!open[nj * W + wrap(i + di)]) { coastal[s] = 1; break; } }
  }
  const rad = Math.PI / 180;
  const arc = (la1, lo1, la2, lo2) => { const a = Math.sin((la2 - la1) * rad / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin((lo2 - lo1) * rad / 2) ** 2; return 2 * Math.asin(Math.min(1, Math.sqrt(a))) / rad; };

  function nearestOpen(lat, lon) {
    const ci = wrap(Math.floor((lon + 180) / D)), cj = Math.max(0, Math.min(H - 1, Math.floor((90 - lat) / D)));
    if (open[cj * W + ci]) return cj * W + ci;
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= 80; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const j = cj + dj; if (j < 0 || j >= H) continue;
        const s = j * W + wrap(ci + di); if (!open[s]) continue;
        const d = arc(lat, lon, latOf(j), lonOf(wrap(ci + di))); if (d < bestD) { bestD = d; best = s; }
      }
      if (best >= 0 && r * D * 0.5 > bestD) break;      /* nothing in a wider ring can be nearer */
    }
    return best;
  }

  /* A*: 8-connected, wrapping east-west. Typed-array heap; the estimate to the goal is the great-circle
     angle from precomputed unit vectors, weighted a little (x1.25) so searches stay fast. */
  const ux = new Float32Array(N), uy = new Float32Array(N), uz = new Float32Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const la = latOf(j) * rad, lo = lonOf(i) * rad, s = j * W + i; ux[s] = Math.cos(la) * Math.cos(lo); uy[s] = Math.cos(la) * Math.sin(lo); uz[s] = Math.sin(la); }
  const est = (a, b) => Math.acos(Math.max(-1, Math.min(1, ux[a] * ux[b] + uy[a] * uy[b] + uz[a] * uz[b]))) / rad;
  const g = new Float32Array(N), from = new Int32Array(N), seen = new Int32Array(N), done = new Int32Array(N); let stamp = 0;
  let hs = new Int32Array(1 << 16), hk = new Float32Array(1 << 16), hn = 0;
  const push = (s, f) => {
    if (hn === hs.length) { const a = new Int32Array(hn * 2); a.set(hs); hs = a; const b = new Float32Array(hn * 2); b.set(hk); hk = b; }
    let k = hn++; while (k) { const p = (k - 1) >> 1; if (hk[p] <= f) break; hs[k] = hs[p]; hk[k] = hk[p]; k = p; } hs[k] = s; hk[k] = f;
  };
  const pop = () => {
    const top = hs[0]; const ls = hs[--hn], lf = hk[hn]; let k = 0;
    for (;;) { const a = 2 * k + 1; if (a >= hn) break; const b = a + 1; const m = b < hn && hk[b] < hk[a] ? b : a; if (hk[m] >= lf) break; hs[k] = hs[m]; hk[k] = hk[m]; k = m; }
    hs[k] = ls; hk[k] = lf; return top;
  };
  function search(s0, s1) {
    stamp++; hn = 0;
    seen[s0] = stamp; g[s0] = 0; from[s0] = -1; push(s0, 0);
    while (hn) {
      const s = pop(); if (done[s] === stamp) continue; done[s] = stamp; if (s === s1) break;
      const i = s % W, j = (s / W) | 0, gs = g[s];
      for (let dj = -1; dj <= 1; dj++) { const nj = j + dj; if (nj < 0 || nj >= H) continue; const cr = cosRow[nj];
        for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const n = nj * W + wrap(i + di); if (!open[n] || done[n] === stamp) continue;
          const ng = gs + Math.sqrt(di * di * cr * cr + dj * dj) * D * (coastal[n] && n !== s1 ? 1.6 : 1);
          if (seen[n] !== stamp || ng < g[n]) { seen[n] = stamp; g[n] = ng; from[n] = s; push(n, ng + 1.25 * est(n, s1)); }
        } }
    }
    if (done[s1] !== stamp) return null;
    const path = []; for (let s = s1; s >= 0; s = from[s]) path.push(s); return path.reverse();
  }
  /* straight legs where the water allows: clear of land and of the coastal cells, at most 25 degrees long */
  function clear(a, b) {
    const ai = a % W, aj = (a / W) | 0; let di = (b % W) - ai; const dj = ((b / W) | 0) - aj;
    if (di > W / 2) di -= W; if (di < -W / 2) di += W;
    if (Math.max(Math.abs(di), Math.abs(dj)) > 50) return false;
    const n = Math.max(Math.abs(di), Math.abs(dj)) * 2;
    for (let k = 1; k < n; k++) { const s = Math.round(aj + (dj * k) / n) * W + wrap(Math.round(ai + (di * k) / n)); if (!open[s] || coastal[s]) return false; }
    return true;
  }
  function straighten(path) {
    const out = [path[0]]; let k = 0;
    while (k < path.length - 1) { let far = k + 1; for (let m = Math.min(path.length - 1, k + 60); m > k + 1; m--) if (clear(path[k], path[m])) { far = m; break; } out.push(path[far]); k = far; }
    return out;
  }
  const cache = new Map();
  return {
    /* waypoints in degrees, from the ship's position to the dock nearest the target */
    route(fromLL, toLL) {
      const s0 = nearestOpen(fromLL.lat, fromLL.lon), s1 = nearestOpen(toLL.lat, toLL.lon);
      if (s0 < 0 || s1 < 0) return null;
      const key = s0 + ':' + s1; let cells = cache.get(key);
      if (!cells) { const p = search(s0, s1); if (!p) return null; cells = straighten(p); cache.set(key, cells); if (cache.size > 200) cache.delete(cache.keys().next().value); }
      const pts = cells.map((s) => ({ lat: latOf((s / W) | 0), lon: lonOf(s % W) }));
      if (open[s0] && arc(fromLL.lat, fromLL.lon, pts[0].lat, pts[0].lon) < 1.5) pts[0] = { lat: fromLL.lat, lon: fromLL.lon };
      return pts;
    },
    dock(lat, lon) { const s = nearestOpen(lat, lon); return s < 0 ? null : { lat: latOf((s / W) | 0), lon: lonOf(s % W) }; }
  };
}
