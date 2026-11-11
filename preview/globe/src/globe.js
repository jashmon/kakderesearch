/* The homepage globe. A photographic Earth lit by the sun where it actually
   is right now, with the day's market-moving headlines pinned to the places
   they name. Hover or focus an event to read it; drag to turn the globe.

   Built on three.js, bundled into js/globe.bundle.js (same origin, no CDN, so
   the site's script-src 'self' policy holds). Without WebGL, with scripts off
   or before the textures arrive, the event list beside it carries everything
   the globe does. */

import {
  AdditiveBlending, BackSide, BufferGeometry, CircleGeometry, Color, Float32BufferAttribute, Group, LinearFilter, Mesh,
  MeshBasicMaterial, PerspectiveCamera, Points, PointsMaterial, RingGeometry, SRGBColorSpace, Scene, ShaderMaterial,
  SphereGeometry, TextureLoader, Vector3, WebGLRenderer
} from 'three';

const DEG = Math.PI / 180;
const ACCENT = 0x58be96;   /* --accent-bright */
const CREAM = 0xf4f0e6;    /* --paper */

/* lat/lon → a point on the unit sphere, matching three's equirectangular UVs. */
export function toVec(lat, lon, r = 1) {
  const phi = (90 - lat) * DEG, theta = (lon + 180) * DEG;
  return new Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/* Where the sun is overhead at a given moment (good to about a degree). */
export function subsolar(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 864e5;
  const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return { lat: decl, lon: (12 - hours) * 15 };
}

const EARTH_VERT = `
  uniform vec3 sunDir;
  varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying vec3 vNView; varying vec3 vSunView;
  void main() {
    vUv = uv; vN = normalize(normal);
    vNView = normalize(normalMatrix * normal);
    vSunView = normalize((modelViewMatrix * vec4(sunDir, 0.0)).xyz);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

/* Day and night are blended across the terminator; the ocean takes a soft
   specular glint; the limb picks up the atmosphere. The grade leans the
   shadows toward the site's navy so the planet sits in the page. */
const EARTH_FRAG = `
  uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cloudMap;
  uniform vec3 sunDir; uniform float cloudShift; uniform float ready;
  varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying vec3 vNView; varying vec3 vSunView;
  void main() {
    vec3 n = normalize(vN);
    float d = dot(n, normalize(sunDir));
    float lit = smoothstep(-0.18, 0.28, d);
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    float water = smoothstep(0.02, 0.12, day.b - max(day.r, day.g));
    float cloud = texture2D(cloudMap, vec2(vUv.x + cloudShift, vUv.y)).r;
    float cloudShadow = texture2D(cloudMap, vec2(vUv.x + cloudShift - 0.004, vUv.y + 0.002)).r;

    vec3 dayCol = day * (0.22 + 1.05 * max(d, 0.0));
    dayCol *= 1.0 - 0.35 * cloudShadow;
    dayCol = mix(dayCol, vec3(1.0) * (0.35 + 0.75 * max(d, 0.0)), smoothstep(0.3, 0.95, cloud) * 0.7);

    vec3 lights = pow(night, vec3(1.35)) * vec3(1.0, 0.82, 0.58) * 2.4;
    vec3 nightCol = day * vec3(0.10, 0.13, 0.19) + lights * (1.0 - 0.75 * cloud);

    vec3 col = mix(nightCol, dayCol, lit);

    vec3 nView = normalize(vNView);
    vec3 h = normalize(normalize(vSunView) + vView);
    col += vec3(0.95, 0.9, 0.8) * pow(max(dot(nView, h), 0.0), 60.0) * water * lit * 0.55 * (1.0 - cloud);

    float rim = pow(1.0 - max(dot(nView, vView), 0.0), 3.2);
    col += vec3(0.30, 0.52, 0.86) * rim * (0.25 + 0.75 * lit);
    col = mix(col, col * vec3(0.92, 0.97, 1.06), 0.5);
    col = mix(vec3(0.055, 0.115, 0.22) * (0.5 + rim), col, ready);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const ATMO_VERT = `
  varying vec3 vN; varying vec3 vWorldN;
  void main() { vN = normalize(normalMatrix * normal); vWorldN = normalize(normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ATMO_FRAG = `
  uniform vec3 sunDir; varying vec3 vN; varying vec3 vWorldN;
  void main() {
    float glow = pow(clamp(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
    float lit = 0.35 + 0.65 * smoothstep(-0.4, 0.5, dot(vWorldN, normalize(sunDir)));
    gl_FragColor = vec4(vec3(0.28, 0.5, 0.92) * glow * lit * 1.25, glow * lit);
  }`;

export function createGlobe(host, opts = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.matchMedia('(max-width: 720px)').matches;
  let renderer;
  try { renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (_) { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 4.6);

  const world = new Group();      /* everything that turns with the Earth */
  scene.add(world);

  const loader = new TextureLoader();
  const base = opts.assets || 'assets/globe/';
  const uniforms = { dayMap: { value: null }, nightMap: { value: null }, cloudMap: { value: null }, sunDir: { value: new Vector3(1, 0, 0) }, cloudShift: { value: 0 }, ready: { value: 0 } };
  let loaded = 0;
  const tex = (file, key, colour) => loader.load(base + file, (t) => {
    if (colour) t.colorSpace = SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.minFilter = LinearFilter; t.generateMipmaps = false;
    uniforms[key].value = t; if (++loaded === 3) { fadeIn = performance.now(); host.classList.add('is-ready'); }
  });
  let fadeIn = 0;
  tex(small ? 'earth-day-2k.webp' : 'earth-day-4k.webp', 'dayMap', true);
  tex('earth-night-2k.webp', 'nightMap', true);
  tex('earth-clouds-2k.webp', 'cloudMap', false);

  const earth = new Mesh(new SphereGeometry(1, 128, 96), new ShaderMaterial({ uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }));
  world.add(earth);
  const atmo = new Mesh(new SphereGeometry(1.16, 96, 64), new ShaderMaterial({ uniforms: { sunDir: uniforms.sunDir }, vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: BackSide, blending: AdditiveBlending, transparent: true, depthWrite: false }));
  world.add(atmo);

  /* A sparse, fixed star field: enough to say "space", not enough to compete. */
  const starPos = []; let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 520; i++) { const v = new Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(18 + rnd() * 6); starPos.push(v.x, v.y, v.z); }
  const starGeo = new BufferGeometry(); starGeo.setAttribute('position', new Float32BufferAttribute(starPos, 3));
  scene.add(new Points(starGeo, new PointsMaterial({ color: CREAM, size: 0.05, transparent: true, opacity: 0.5, sizeAttenuation: true })));

  function setSun(date) { const s = subsolar(date); uniforms.sunDir.value.copy(toVec(s.lat, s.lon)); }
  setSun(new Date());

  /* ----- event markers ----- */
  const markers = [];
  const markerGroup = new Group(); world.add(markerGroup);
  function setEvents(events) {
    while (markerGroup.children.length) markerGroup.remove(markerGroup.children[0]);
    markers.length = 0;
    events.forEach((e, i) => {
      const pos = toVec(e.lat, e.lon, 1.012);
      const g = new Group(); g.position.copy(pos); g.lookAt(pos.clone().multiplyScalar(2));
      const size = 0.012 + 0.005 * (e.weight || 1);
      const dot = new Mesh(new CircleGeometry(size, 24), new MeshBasicMaterial({ color: ACCENT, transparent: true }));
      const halo = new Mesh(new RingGeometry(size * 1.5, size * 1.75, 40), new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 }));
      const pulse = new Mesh(new RingGeometry(size * 1.6, size * 1.9, 40), new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 }));
      g.add(pulse, halo, dot); markerGroup.add(g);
      markers.push({ e, g, dot, halo, pulse, normal: pos.clone().normalize(), phase: (i * 0.37) % 1, screen: { x: 0, y: 0, visible: false } });
    });
  }

  /* ----- orientation: yaw (spin) and pitch (tilt), eased toward a target ----- */
  let yaw = 0, pitch = 0.32, tYaw = 0, tPitch = 0.32, spin = reduce ? 0 : 0.045, dragging = false, velocity = 0;
  let active = null, hover = null, lastInput = 0, focusHold = false;
  const yawFor = (m) => -Math.atan2(m.normal.x, m.normal.z);
  const nearest = (from, to) => to + Math.round((from - to) / (2 * Math.PI)) * 2 * Math.PI;
  function face(id, hold) {
    const m = markers.find((x) => x.e.id === id); if (!m) return;
    tYaw = nearest(yaw, yawFor(m)); tPitch = Math.max(-0.75, Math.min(0.75, Math.asin(m.normal.y) * 0.85));
    velocity = 0; lastInput = performance.now(); focusHold = !!hold;
    if (reduce) { yaw = tYaw; pitch = tPitch; }
  }
  function setActive(id) { active = id; }

  /* ----- pointer: hover picks the nearest visible marker; drag turns the globe ----- */
  let px = -1e4, py = -1e4, down = null;
  const rect = () => canvas.getBoundingClientRect();
  canvas.addEventListener('pointermove', (ev) => {
    const r = rect(); px = ev.clientX - r.left; py = ev.clientY - r.top;
    if (down) {
      const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      if (!dragging && Math.abs(dx) + Math.abs(dy) > 5) { dragging = true; canvas.classList.add('is-dragging'); }
      if (dragging) { tYaw = yaw = down.yaw + dx * 0.006; tPitch = pitch = Math.max(-0.9, Math.min(0.9, down.pitch + dy * 0.004)); velocity = (ev.clientX - down.lx) * 0.006; down.lx = ev.clientX; focusHold = false; }
    }
    lastInput = performance.now();
  });
  canvas.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, lx: ev.clientX, yaw, pitch }; if (ev.pointerType === 'mouse') canvas.setPointerCapture(ev.pointerId); });
  const up = (ev) => {
    if (down && !dragging && hover) opts.onSelect && opts.onSelect(hover.e, true);
    if (dragging) tYaw = yaw + velocity * 14;
    down = null; dragging = false; canvas.classList.remove('is-dragging');
    if (ev.pointerType !== 'mouse') { px = py = -1e4; }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (!down) { px = py = -1e4; } });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.position.z = w / h < 0.9 ? 5.4 : 4.6; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host); resize();

  let running = true, visible = true, last = performance.now(), tick = 0;
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible && running) loop(performance.now()); }, { threshold: 0.02 }).observe(host);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) { last = performance.now(); loop(last); } });

  const v = new Vector3(); const camDir = new Vector3();
  function loop(now) {
    if (!running || !visible || document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; tick += dt;
    const idle = now - lastInput > 2600 && !dragging && !hover && !focusHold;
    if (idle && !reduce) tYaw += spin * dt;
    const k = 1 - Math.exp(-dt * 4.2);
    yaw += (tYaw - yaw) * k; pitch += (tPitch - pitch) * k;
    if (idle) tPitch += (0.32 - tPitch) * (1 - Math.exp(-dt * 0.6));
    world.rotation.set(pitch, yaw, 0);
    uniforms.cloudShift.value = reduce ? 0 : (tick * 0.0009) % 1;
    if (fadeIn) uniforms.ready.value = Math.min(1, (now - fadeIn) / 900);
    if (Math.floor(tick) % 60 === 0) setSun(new Date());

    /* project markers, pick the one under the pointer */
    const w = host.clientWidth, h = host.clientHeight; let best = null, bestD = 26;
    world.updateMatrixWorld();
    for (const m of markers) {
      v.copy(m.normal).applyQuaternion(world.quaternion);
      camDir.copy(camera.position).sub(v).normalize();
      const facing = v.dot(camDir);
      v.multiplyScalar(1.012).project(camera);
      m.screen.x = (v.x * 0.5 + 0.5) * w; m.screen.y = (-v.y * 0.5 + 0.5) * h; m.screen.visible = facing > 0.12;
      const fade = Math.max(0, Math.min(1, (facing - 0.05) / 0.25));
      const on = active === m.e.id;
      m.dot.material.opacity = fade; m.halo.material.opacity = fade * (on ? 1 : 0.55);
      m.dot.material.color.setHex(on ? CREAM : ACCENT); m.halo.material.color.setHex(on ? CREAM : ACCENT);
      const s = on ? 1.5 : 1; m.dot.scale.setScalar(s); m.halo.scale.setScalar(s);
      const p = reduce ? 0 : (tick * 0.45 + m.phase) % 1;
      m.pulse.scale.setScalar(1 + p * (2.2 + 0.6 * (m.e.weight || 1))); m.pulse.material.opacity = reduce ? 0 : fade * (1 - p) * 0.7;
      if (m.screen.visible) { const d = Math.hypot(m.screen.x - px, m.screen.y - py); if (d < bestD) { bestD = d; best = m; } }
    }
    if (best !== hover && !dragging) { hover = best; canvas.style.cursor = hover ? 'pointer' : ''; opts.onHover && opts.onHover(hover ? hover.e : null); }
    opts.onFrame && opts.onFrame(markers);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    setEvents, face, setActive, canvas,
    screenOf(id) { const m = markers.find((x) => x.e.id === id); return m ? m.screen : null; },
    release() { focusHold = false; lastInput = performance.now() - 1200; },
    destroy() { running = false; renderer.dispose(); canvas.remove(); }
  };
}
