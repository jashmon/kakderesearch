/* The homepage globe: a blue and green Earth, shaded like a relief globe
   rather than photographed. Land and sea come from a mask of Natural
   Earth's India point-of-view edition (assets/img/globe-land.png, built by
   tools/globe/make-land.mjs), with every country boundary drawn over it
   and India's outline drawn whole, as on India's official maps.

   Layer one, the hero: the day's market-relevant events, pinned to the
   places their headlines name. A cargo ship sails real sea routes between
   them (ship.js, sea-route.js) and makes for any point the reader points at.
   Layer two, after the scroll: the twenty leading financial centres and
   the place the work is done from, joined by arcs.

   The reader can turn it (drag), zoom it (the + and − buttons, a pinch, or
   Ctrl/Cmd + wheel; an ordinary wheel still scrolls the page) and
   double-click a place to go there. The page drives the same camera: as the
   hero scrolls away the globe closes in on India.

   three.js is bundled in (js/globe/globe.bundle.js), same origin, so the
   site's script-src 'self' policy holds. */

import {
  AdditiveBlending, BackSide, BufferGeometry, CanvasTexture, CircleGeometry, Color, Float32BufferAttribute, Group, Line,
  LineBasicMaterial, LinearFilter, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, RingGeometry, SRGBColorSpace,
  Scene, ShaderMaterial, SphereGeometry, Texture, LinearMipmapLinearFilter, Vector2, Vector3, WebGLRenderer
} from 'three';
import { createSeaRouter } from './sea-route.js';
import { createShip } from './ship.js';
import { LineSegments2 } from 'three-ex/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three-ex/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three-ex/lines/LineMaterial.js';

const DEG = Math.PI / 180;
const ACCENT = 0x58be96;   /* --accent-bright */
const CREAM = 0xf4f0e6;    /* --paper */
const NAVY = 0x0e1d38;     /* --navy-deep */

/* lat/lon → a point on the sphere, matching three's equirectangular UVs. */
export function toVec(lat, lon, r = 1) {
  const phi = (90 - lat) * DEG, theta = (lon + 180) * DEG;
  return new Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

const VERT = `
  varying vec2 vUv; varying vec3 vN; varying vec3 vNView; varying vec3 vView;
  void main() {
    vUv = uv; vN = normalize(normal); vNView = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

/* Sea: deep blue in open water, lighter over the shelf near the coast
   (from a blurred copy of the mask). Land: greens
   that shift with latitude, mottled with noise, icy toward the poles.
   One light from the upper left, fixed to the view. */
const FRAG = `
  uniform sampler2D landMap; uniform sampler2D coastMap; uniform float ready;
  uniform vec3 focus; uniform float focusOn; uniform vec3 pointer; uniform float pointerOn;
  varying vec2 vUv; varying vec3 vN; varying vec3 vNView; varying vec3 vView;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
  void main() {
    vec3 n = normalize(vN);
    float m = texture2D(landMap, vUv).r;
    float aa = fwidth(m) * 0.8 + 0.01;
    float land = smoothstep(0.5 - aa, 0.5 + aa, m) * ready;
    float coast = texture2D(coastMap, vUv).r;
    float lat = asin(clamp(n.y, -1.0, 1.0)) * 57.29578; float al = abs(lat);
    float nz = noise(n * 7.0) * 0.55 + noise(n * 19.0) * 0.3 + noise(n * 53.0) * 0.15;

    vec3 tropic = vec3(0.13, 0.40, 0.19), temperate = vec3(0.30, 0.53, 0.25), boreal = vec3(0.20, 0.36, 0.22), tundra = vec3(0.47, 0.52, 0.43), ice = vec3(0.88, 0.92, 0.95);
    vec3 lc = mix(tropic, temperate, smoothstep(12.0, 34.0, al));
    lc = mix(lc, boreal, smoothstep(46.0, 58.0, al));
    lc = mix(lc, tundra, smoothstep(61.0, 69.0, al));
    lc *= 0.82 + 0.36 * nz;
    lc = mix(lc, ice, lat > 0.0 ? smoothstep(69.0, 77.0, al) : smoothstep(58.0, 64.0, al));

    vec3 deep = vec3(0.030, 0.150, 0.330), open = vec3(0.050, 0.270, 0.500), shelf = vec3(0.140, 0.470, 0.600);
    vec3 sc = mix(deep, open, smoothstep(0.0, 0.10, coast));
    sc = mix(sc, shelf, smoothstep(0.40, 0.92, coast) * 0.38);
    sc *= 0.94 + 0.12 * noise(n * 12.0);
    sc = mix(sc, vec3(0.30, 0.42, 0.50), smoothstep(62.0, 75.0, al) * 0.5);

    vec3 nv = normalize(vNView), L = normalize(vec3(-0.55, 0.6, 0.6));
    float diff = max(dot(nv, L), 0.0);
    vec3 col = mix(sc, lc, land) * (0.52 + 0.52 * diff);

    float nearFocus = focusOn * smoothstep(0.985, 0.9995, dot(n, normalize(focus)));
    float nearPointer = pointerOn * smoothstep(0.990, 0.9995, dot(n, normalize(pointer)));
    col += vec3(0.957, 0.941, 0.902) * (0.10 * nearPointer + 0.12 * nearFocus);

    float facing = max(dot(nv, vView), 0.0); float rim = pow(1.0 - facing, 2.6);
    col = mix(col, vec3(0.50, 0.74, 0.96), rim * 0.42);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const ATMO_VERT = `varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ATMO_FRAG = `varying vec3 vN; void main() { float g = pow(clamp(0.70 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.4); gl_FragColor = vec4(vec3(0.34, 0.58, 0.92) * g * 0.8, g * 0.7); }`;

/* The land mask (greyscale PNG, equirectangular, white land) and a blurred
   copy for the shallow water along coasts, made by halving it down to 512 x 256. */
function landTextures(url, done) {
  const img = new Image();
  img.onload = () => {
    const land = new Texture(img); land.minFilter = LinearMipmapLinearFilter; land.magFilter = LinearFilter; land.generateMipmaps = true; land.needsUpdate = true;
    let src = img, w = img.width, h = img.height;
    while (w > 512) { w = Math.max(512, w >> 1); h = Math.max(256, h >> 1); const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h); src = c; }
    const coast = new CanvasTexture(src); coast.minFilter = LinearFilter; coast.magFilter = LinearFilter; coast.generateMipmaps = false;
    done(land, coast);
  };
  img.onerror = () => done(null, null);
  img.src = url;
}

export function createGlobe(host, opts = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try { renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (_) { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  const world = new Group(); scene.add(world);

  const uniforms = { landMap: { value: null }, coastMap: { value: null }, ready: { value: 0 }, focus: { value: new Vector3(0, 0, 1) }, focusOn: { value: 0 }, pointer: { value: new Vector3(0, 0, 1) }, pointerOn: { value: 0 } };
  let fadeIn = 0;
  landTextures(opts.land || 'assets/img/globe-land.png', (t, c) => { if (t) { t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); uniforms.landMap.value = t; uniforms.coastMap.value = c; fadeIn = performance.now(); } host.classList.add('is-ready'); });

  const earth = new Mesh(new SphereGeometry(1, 128, 96), new ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }));
  world.add(earth);
  scene.add(new Mesh(new SphereGeometry(1.18, 64, 48), new ShaderMaterial({ vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: BackSide, blending: AdditiveBlending, transparent: true, depthWrite: false })));

  /* ----- boundaries: every country border as a light hairline, coasts in navy, India's outline in cream -----
     From assets/data/world-borders.json (Natural Earth, India point-of-view edition): India is drawn as
     its official maps draw it, whole, with no disputed or control lines. */
  const lineGroup = new Group(); world.add(lineGroup);
  const lineMats = [];
  function addLines(encoded, radius, color, opacity, closed, width) {
    const pos = [];
    for (const e of encoded) {
      let x = 0, y = 0, prev = null, first = null;
      for (let i = 0; i < e.length; i += 2) {
        x += e[i]; y += e[i + 1]; const v = toVec(y / 100, x / 100, radius);
        if (prev) pos.push(prev.x, prev.y, prev.z, v.x, v.y, v.z); else first = v; prev = v;
      }
      if (closed && prev && first) pos.push(prev.x, prev.y, prev.z, first.x, first.y, first.z);
    }
    /* screen-space lines of a set pixel width, so a border is as legible zoomed out as zoomed in */
    const geo = new LineSegmentsGeometry(); geo.setPositions(pos);
    const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0, depthWrite: false });
    mat.resolution.set(host.clientWidth || 1, host.clientHeight || 1); mat.userData.target = opacity; lineMats.push(mat);
    lineGroup.add(new LineSegments2(geo, mat));
  }
  let linesIn = 0;
  if (opts.borders) fetch(opts.borders).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) return;
    addLines(d.coasts, 1.0022, NAVY, 0.28, false, 1);
    addLines(d.borders, 1.0024, CREAM, 0.6, false, 1.1);
    addLines(d.india, 1.0034, CREAM, 1, true, 2.2);
    linesIn = performance.now();
  }).catch(() => {});

  /* ----- points: events (layer 0) and financial centres (layer 1) ----- */
  const markers = [];
  const layers = [new Group(), new Group()]; world.add(layers[0], layers[1]);
  /* every point is a light dot inside a navy ring, so it reads on green land and on blue sea alike */
  function addPoint(layer, e, { size, color, ring, pulse }) {
    const pos = toVec(e.lat, e.lon, 1.006);
    const g = new Group(); g.position.copy(pos); g.lookAt(pos.clone().multiplyScalar(2));
    const dot = new Mesh(new CircleGeometry(size, 28), new MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    const halo = new Mesh(new RingGeometry(size * 0.98, size * (ring ? 1.55 : 1.4), 44), new MeshBasicMaterial({ color: NAVY, transparent: true, depthWrite: false }));
    const wave = pulse ? new Mesh(new RingGeometry(size * 1.8, size * 2.05, 44), new MeshBasicMaterial({ color: CREAM, transparent: true, opacity: 0 })) : null;
    if (wave) g.add(wave); if (halo) g.add(halo); g.add(dot); layers[layer].add(g);
    const m = { e, layer, g, dot, halo, wave, color, normal: pos.clone().normalize(), phase: (markers.length * 0.37) % 1, screen: { x: 0, y: 0, visible: false } };
    markers.push(m); return m;
  }
  function clearLayer(layer) {
    while (layers[layer].children.length) layers[layer].remove(layers[layer].children[0]);
    for (let i = markers.length - 1; i >= 0; i--) if (markers[i].layer === layer) markers.splice(i, 1);
  }
  function setEvents(events) {
    clearLayer(0);
    for (const e of events) addPoint(0, e, { size: 0.0095 + 0.003 * (e.weight || 1), color: CREAM, ring: true, pulse: (e.weight || 1) >= 3 });
  }

  /* centres and the base, with an arc from the base to each centre */
  const arcs = [];
  function setCentres(base, centres) {
    clearLayer(1); arcs.length = 0;
    const a = toVec(base.lat, base.lon).normalize();
    for (const c of centres) {
      addPoint(1, Object.assign({ kind: 'centre' }, c), { size: 0.0085, color: CREAM, ring: false, pulse: false });
      const b = toVec(c.lat, c.lon).normalize(); const angle = a.angleTo(b); const pts = []; const N = 64;
      for (let i = 0; i <= N; i++) {
        const t = i / N; const s = Math.sin(angle) || 1;
        const p = a.clone().multiplyScalar(Math.sin((1 - t) * angle) / s).add(b.clone().multiplyScalar(Math.sin(t * angle) / s));
        p.normalize().multiplyScalar(1.006 + Math.sin(Math.PI * t) * Math.min(0.32, angle * 0.16)); pts.push(p.x, p.y, p.z);
      }
      const geo = new BufferGeometry(); geo.setAttribute('position', new Float32BufferAttribute(pts, 3)); geo.setDrawRange(0, 0);
      const line = new Line(geo, new LineBasicMaterial({ color: CREAM, transparent: true, opacity: 0 }));
      layers[1].add(line); arcs.push({ line, n: N + 1, delay: arcs.length * 0.025 });
    }
    addPoint(1, Object.assign({ kind: 'base' }, base), { size: 0.016, color: ACCENT, ring: true, pulse: true });
  }

  /* ----- the cargo ship ----- */
  let ship = null, follow = false;
  const pendingShip = [];
  if (opts.seaGrid) fetch(opts.seaGrid).then((r) => (r.ok ? r.json() : null)).then((grid) => {
    const router = grid ? createSeaRouter(grid) : null;
    ship = createShip(scene, world, camera, router, { reduce, width: () => host.clientWidth, height: () => host.clientHeight });
    for (const f of pendingShip.splice(0)) f();
  }).catch(() => {});
  const withShip = (f) => { if (ship) f(); else pendingShip.push(f); };
  function sailTo(target, o = {}) { if (o.follow !== undefined) follow = o.follow; withShip(() => ship.sailTo(target, o)); }
  function placeShip(target) { withShip(() => ship.placeAt(target)); }

  /* ----- view state ----- */
  let yaw = 0.6, pitch = 0.3, tYaw = 0.6, tPitch = 0.3, dragging = false, velocity = 0;
  let zoom = 0, userZoom = 0, sceneZoom = 0;          /* 0 = whole globe, 1 = closest */
  let mix = 0, tMix = 0;                              /* 0 = events layer, 1 = centres layer */
  let active = null, hover = null, lastInput = 0, userInput = -1e9, hold = false, shiftX = 0, tShiftX = 0;
  const spin = reduce ? 0 : 0.04;
  const yawFor = (n) => -Math.atan2(n.x, n.z);
  const nearest = (from, to) => to + Math.round((from - to) / (2 * Math.PI)) * 2 * Math.PI;
  function faceNormal(n, keep) {
    tYaw = nearest(yaw, yawFor(n)); tPitch = Math.max(-0.8, Math.min(0.8, Math.asin(n.y) * 0.9));
    velocity = 0; lastInput = performance.now(); hold = !!keep;
    if (reduce) { yaw = tYaw; pitch = tPitch; }
  }
  function face(id, keep) { const m = markers.find((x) => x.e.id === id); if (m) faceNormal(m.normal, keep); }
  function faceLatLon(lat, lon, keep, snap) { faceNormal(toVec(lat, lon).normalize(), keep); if (snap) { yaw = tYaw; pitch = tPitch; } }
  function setActive(id) { active = id; const m = id && markers.find((x) => x.e.id === id); uniforms.focusOn.value = m ? 1 : 0; if (m) uniforms.focus.value.copy(m.normal); }
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function zoomBy(delta) { userZoom = clamp01(userZoom + delta); lastInput = performance.now(); opts.onZoom && opts.onZoom(userZoom); }
  function resetView() { userZoom = 0; hold = false; tPitch = 0.3; lastInput = performance.now() - 3000; opts.onZoom && opts.onZoom(0); }
  /* the page sets these as it scrolls: how far in, which layer, where to look, how far right the globe sits */
  function setScene(s) { sceneZoom = clamp01(s.zoom || 0); tMix = clamp01(s.mix || 0); tShiftX = s.shiftX || 0; if (s.look) { const n = toVec(s.look.lat, s.look.lon).normalize(); tYaw = nearest(yaw, yawFor(n)); tPitch = Math.asin(n.y) * 0.9; hold = true; } else if (s.release) hold = false; }

  /* ----- pointer ----- */
  let px = -1e4, py = -1e4, down = null; const pointers = new Map(); let pinch = 0;
  const ray = new Raycaster(); const ndc = new Vector2(); const hit = new Vector3();
  const rect = () => canvas.getBoundingClientRect();
  function pointerOnSphere() {
    const w = host.clientWidth, h = host.clientHeight; if (px < 0 || !w) return null;
    ndc.set((px / w) * 2 - 1, -(py / h) * 2 + 1); ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction; const b = o.dot(d), c = o.dot(o) - 1; const disc = b * b - c;
    if (disc < 0) return null;
    hit.copy(d).multiplyScalar(-b - Math.sqrt(disc)).add(o);
    return hit.clone().applyQuaternion(world.quaternion.clone().invert()).normalize();
  }
  canvas.addEventListener('pointermove', (ev) => {
    userInput = performance.now();
    const r = rect(); px = ev.clientX - r.left; py = ev.clientY - r.top;
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomBy((dist - pinch) / 260); pinch = dist; dragging = false; return;
    }
    if (down) {
      const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      if (!dragging && Math.abs(dx) + Math.abs(dy) > 5) { dragging = true; canvas.classList.add('is-dragging'); }
      if (dragging) {
        const k = 0.006 * (1 - 0.6 * zoom);
        tYaw = yaw = down.yaw + dx * k; tPitch = pitch = Math.max(-1.1, Math.min(1.1, down.pitch + dy * k * 0.7));
        velocity = (ev.clientX - down.lx) * k; down.lx = ev.clientX; hold = true;
      }
    }
    lastInput = performance.now();
  });
  canvas.addEventListener('pointerdown', (ev) => {
    userInput = performance.now();
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 1) { down = { x: ev.clientX, y: ev.clientY, lx: ev.clientX, yaw, pitch }; if (ev.pointerType === 'mouse') canvas.setPointerCapture(ev.pointerId); }
    else { down = null; pinch = 0; }
  });
  const up = (ev) => {
    pointers.delete(ev.pointerId); pinch = 0;
    if (down && !dragging) { if (hover) opts.onSelect && opts.onSelect(hover.e); else opts.onEmptyClick && opts.onEmptyClick(); }
    if (dragging) tYaw = yaw + velocity * 12;
    down = null; dragging = false; canvas.classList.remove('is-dragging');
    if (ev.pointerType !== 'mouse') { px = py = -1e4; }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (!down) { px = py = -1e4; } });
  /* Ctrl/Cmd + wheel (which is also what a trackpad pinch sends) zooms; a plain wheel is left to scroll the page. */
  canvas.addEventListener('wheel', (ev) => { if (!ev.ctrlKey && !ev.metaKey) return; ev.preventDefault(); userInput = performance.now(); zoomBy(-ev.deltaY * 0.004); }, { passive: false });
  canvas.addEventListener('dblclick', () => { const p = pointerOnSphere(); if (p) { faceNormal(p, true); zoomBy(0.35); } });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    for (const m of lineMats) m.resolution.set(w, h);
  }
  new ResizeObserver(resize).observe(host); resize();

  let running = true, visible = true, last = performance.now(), tick = 0, raf = 0;
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible) kick(); }, { threshold: 0.01 }).observe(host);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  function kick() { if (!raf && running && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } }

  const v = new Vector3(); const camDir = new Vector3();
  function loop(now) {
    raf = 0; if (!running || !visible || document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; tick += dt;
    const idle = now - lastInput > 2600 && !dragging && !hover && !hold;
    /* during the tour the camera keeps the ship in view; any touch hands the camera back to the reader for a while */
    const following = follow && ship && !dragging && !hover && !hold && now - userInput > 6000;
    if (following) { const n = ship.normal; const ty = nearest(yaw, yawFor(n)), tp = Math.max(-0.8, Math.min(0.8, Math.asin(n.y) * 0.85)); const f = 1 - Math.exp(-dt * 1.6); tYaw += (ty - tYaw) * f; tPitch += (tp - tPitch) * f; }
    else if (idle && !reduce) tYaw += spin * dt;
    const k = reduce ? 1 : 1 - Math.exp(-dt * 4.2);
    yaw += (tYaw - yaw) * k; pitch += (tPitch - pitch) * k;
    if (idle && !following) tPitch += (0.3 - tPitch) * (1 - Math.exp(-dt * 0.6));
    zoom += (clamp01(userZoom + sceneZoom) - zoom) * k; mix += (tMix - mix) * k; shiftX += (tShiftX - shiftX) * k;
    world.rotation.set(pitch, yaw, 0);

    const w = host.clientWidth, h = host.clientHeight; const portrait = w / h < 0.95;
    const far = portrait ? 5.6 : 6.1, near = 2.05;
    camera.position.z = far + (near - far) * (1 - Math.pow(1 - zoom, 2));
    /* the globe sits right of centre on wide screens, and further right as it grows, so the text column stays clear */
    if (shiftX) camera.setViewOffset(w, h, -shiftX * w * (1 + 0.45 * zoom), 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (fadeIn) uniforms.ready.value = Math.min(1, (now - fadeIn) / 900);
    if (linesIn) { const f = Math.min(1, (now - linesIn) / 900); for (const m of lineMats) m.opacity = m.userData.target * f; }

    const p = pointerOnSphere(); uniforms.pointerOn.value += ((p ? 1 : 0) - uniforms.pointerOn.value) * k; if (p) uniforms.pointer.value.copy(p);

    world.updateMatrixWorld(); let best = null, bestD = 24;
    const scale = 1 - 0.45 * zoom;                  /* points shrink as the view closes in, so they stay points */
    for (const m of markers) {
      v.copy(m.normal).applyQuaternion(world.quaternion);
      camDir.copy(camera.position).sub(v).normalize(); const facing = v.dot(camDir);
      v.multiplyScalar(1.006).project(camera);
      m.screen.x = (v.x * 0.5 + 0.5) * w; m.screen.y = (-v.y * 0.5 + 0.5) * h;
      const layerOn = m.layer === 0 ? 1 - mix : mix;
      const fade = clamp01((facing - 0.05) / 0.25) * clamp01((layerOn - 0.35) / 0.4);
      m.screen.visible = facing > 0.12 && layerOn > 0.6;
      const on = active === m.e.id; const hov = hover === m;
      m.dot.material.opacity = fade; m.dot.material.color.setHex(on ? ACCENT : m.color);
      const s = scale * (on ? 1.45 : hov ? 1.3 : 1); m.dot.scale.setScalar(s);
      if (m.halo) { m.halo.material.opacity = fade * 0.95; m.halo.scale.setScalar(s); }
      if (m.wave) { const q = reduce ? 0 : (tick * 0.4 + m.phase) % 1; m.wave.scale.setScalar(scale * (1 + q * 2.6)); m.wave.material.opacity = reduce ? 0 : fade * (1 - q) * 0.6; }
      if (m.screen.visible) { const d = Math.hypot(m.screen.x - px, m.screen.y - py); if (d < bestD) { bestD = d; best = m; } }
    }
    for (const a of arcs) { const t = clamp01((mix - 0.45 - a.delay) / 0.4); a.line.geometry.setDrawRange(0, Math.round(a.n * t)); a.line.material.opacity = 0.55 * t; }
    if (best !== hover && !dragging) { hover = best; canvas.style.cursor = hover ? 'pointer' : ''; opts.onHover && opts.onHover(hover ? hover.e : null); }
    if (ship) ship.update(dt, tick, zoom);
    opts.onFrame && opts.onFrame();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  kick();

  return {
    setEvents, setCentres, setScene, face, faceLatLon, setActive, zoomBy, resetView, canvas, sailTo, placeShip,
    setFollow(v) { follow = !!v; },
    get shipState() { return ship ? ship.state : 'none'; },
    get shipTarget() { return ship ? ship.target : null; },
    get zoom() { return userZoom; },
    screenOf(id) { const m = markers.find((x) => x.e.id === id); return m ? m.screen : null; },
    release() { hold = false; lastInput = performance.now() - 1200; },
    destroy() { running = false; renderer.dispose(); canvas.remove(); }
  };
}
