/* The cargo ship. A small container ship built from boxes (hull, stacked
   containers, bridge, funnel), with a foam wake. It sails sea routes from
   sea-route.js at a steady pace, eases in and out of port, and rolls a
   little on the water. Where the event is inland, a fine line runs from
   the dock to the place. */
import { BoxGeometry, BufferGeometry, Color, ExtrudeGeometry, Float32BufferAttribute, Group, HemisphereLight, DirectionalLight, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, Points, Quaternion, RingGeometry, Shape, ShaderMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three-ex/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three-ex/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three-ex/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three-ex/lines/LineMaterial.js';

const DEG = Math.PI / 180;
const toVec = (lat, lon, r = 1) => { const phi = (90 - lat) * DEG, th = (lon + 180) * DEG; return new Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th)); };
const toLL = (v) => { const n = v.clone().normalize(); const lat = Math.asin(Math.max(-1, Math.min(1, n.y))) / DEG; let lon = Math.atan2(n.z, -n.x) / DEG - 180; if (lon < -180) lon += 360; return { lat, lon }; };
const slerp = (a, b, t) => { const w = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))); if (w < 1e-6) return a.clone(); const s = Math.sin(w); return a.clone().multiplyScalar(Math.sin((1 - t) * w) / s).add(b.clone().multiplyScalar(Math.sin(t * w) / s)); };

/* geometry in ship units: length 1 along +x (bow at +0.5), beam 0.16, up +y */
function buildModel() {
  const parts = [];
  const box = (w, h, d, x, y, z, hex) => { const b = new BoxGeometry(w, h, d); b.translate(x, y, z); const c = new Color(hex); const n = b.attributes.position.count; const cols = []; for (let i = 0; i < n; i++) cols.push(c.r, c.g, c.b); b.setAttribute('color', new Float32BufferAttribute(cols, 3)); parts.push(b.toNonIndexed ? b.toNonIndexed() : b); };
  /* hull: a pointed bow, a square stern, extruded upward */
  const s = new Shape(); s.moveTo(-0.5, -0.08); s.lineTo(0.3, -0.08); s.quadraticCurveTo(0.46, -0.07, 0.52, 0); s.quadraticCurveTo(0.46, 0.07, 0.3, 0.08); s.lineTo(-0.5, 0.08); s.closePath();
  const hull = new ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: false, curveSegments: 6 }); hull.rotateX(-Math.PI / 2); hull.translate(0, -0.03, 0);
  { const c = new Color(0x14294b); const n = hull.attributes.position.count; const cols = []; for (let i = 0; i < n; i++) cols.push(c.r, c.g, c.b); hull.setAttribute('color', new Float32BufferAttribute(cols, 3)); parts.push(hull.toNonIndexed()); }
  box(1.0, 0.012, 0.162, -0.0, 0.03, 0, 0xb8452f);          /* the red boot-top at the waterline */
  /* containers: bays of 2 x 3 stacks, in shipping-line colours */
  const C = [0x0f5f45, 0x4a6fa5, 0xc2553a, 0xe3d9c3, 0x8a9bb0, 0x1f4e79, 0xd08c3c];
  let k = 0;
  for (let bay = 0; bay < 7; bay++) { const x = -0.2 + bay * 0.085;
    for (let row = -1; row <= 1; row++) { const tiers = 1 + ((bay * 3 + row * 5 + 7) % 3);
      for (let t = 0; t < tiers; t++) box(0.078, 0.034, 0.046, x, 0.077 + t * 0.036, row * 0.05, C[(k++ * 5 + bay) % C.length]); } }
  /* bridge and accommodation at the stern, funnel behind it */
  box(0.09, 0.15, 0.15, -0.36, 0.13, 0, 0xf4f0e6);
  box(0.092, 0.02, 0.152, -0.36, 0.19, 0, 0x22324d);        /* bridge windows */
  box(0.13, 0.008, 0.2, -0.345, 0.21, 0, 0xf4f0e6);         /* bridge wings */
  box(0.05, 0.08, 0.05, -0.44, 0.16, 0, 0x14294b);
  box(0.052, 0.018, 0.052, -0.44, 0.19, 0, 0x58be96);       /* funnel band */
  const geo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  geo.computeVertexNormals();
  /* Drawn last, on a cleared depth buffer: the tilted ship is never cut by the sphere, the borders or the points,
     but still hides its own far side. Its visibility on the far side of the globe is handled by fading. */
  const mesh = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 1 })); mesh.renderOrder = 10;
  mesh.onBeforeRender = (renderer) => renderer.clearDepth();
  return mesh;
}

const WAKE_VERT = `attribute float a; uniform float px; varying float va; void main() { va = a; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = px * (0.35 + 0.65 * a); gl_Position = projectionMatrix * mv; }`;
const WAKE_FRAG = `varying float va; void main() { vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, va * 0.75 * (1.0 - smoothstep(0.2, 0.5, d))); }`;

export function createShip(scene, world, camera, router, opts = {}) {
  const reduce = !!opts.reduce;
  /* light for the ship only: the globe and the lines draw unlit */
  scene.add(new HemisphereLight(0xf4f0e6, 0x0e1d38, 1.15));
  const sun = new DirectionalLight(0xffffff, 1.6); sun.position.set(-0.55, 0.6, 0.6); scene.add(camera); camera.add(sun);

  const LEN = 0.17, R = 1.003;
  const ship = new Group(); const model = buildModel(); ship.add(model); ship.matrixAutoUpdate = false; world.add(ship);

  const W_N = 70; const wakePos = new Float32Array(W_N * 3), wakeA = new Float32Array(W_N); let wakeHead = 0, wakeCount = 0;
  const wakeGeo = new BufferGeometry(); wakeGeo.setAttribute('position', new Float32BufferAttribute(wakePos, 3)); wakeGeo.setAttribute('a', new Float32BufferAttribute(wakeA, 1));
  const wakeMat = new ShaderMaterial({ uniforms: { px: { value: 6 * Math.min(window.devicePixelRatio || 1, 2) } }, vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG, transparent: true, depthWrite: false });
  const wake = new Points(wakeGeo, wakeMat); wake.frustumCulled = false; wake.renderOrder = 9; world.add(wake);

  const ripple = new Mesh(new RingGeometry(0.9, 1, 48), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); world.add(ripple);
  const linkMat = new LineMaterial({ color: 0xf4f0e6, linewidth: 1.6, transparent: true, opacity: 0, depthWrite: false });
  let link = null;

  let pos = toVec(19.08, 72.88).normalize(), heading = new Vector3(0, 1, 0);
  let path = null, cum = null, total = 0, t = 0, dur = 1, state = 'docked', target = null, onArrive = null, rippleT = -1, linkFade = 0;
  const basis = new Matrix4(), q = new Quaternion(), viewHeading = new Vector3(1, 0, 0);

  function setLink(dockV, placeV) {
    if (link) { world.remove(link); link.geometry.dispose(); link = null; }
    const ang = dockV.angleTo(placeV); if (ang < 0.6 * DEG) return;
    const n = Math.max(4, Math.ceil(ang / (0.25 * DEG))), p = [];
    for (let i = 0; i < n; i++) { const a = slerp(dockV, placeV, i / n).multiplyScalar(1.004), b = slerp(dockV, placeV, (i + 1) / n).multiplyScalar(1.004); p.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const g = new LineSegmentsGeometry(); g.setPositions(p); link = new LineSegments2(g, linkMat); world.add(link);
  }
  function arrive() {
    state = 'docked'; path = null; rippleT = 0; linkFade = 0;
    if (target) setLink(pos, toVec(target.lat, target.lon).normalize());
    const cb = onArrive; onArrive = null; cb && cb(target);
  }
  function placeAt(tg) {
    target = tg; const d = router && router.dock(tg.lat, tg.lon); pos = (d ? toVec(d.lat, d.lon) : toVec(tg.lat, tg.lon)).normalize();
    const eastish = new Vector3(0, 1, 0).cross(pos).normalize(); if (eastish.lengthSq() > 0.1) heading.copy(eastish);
    wakeCount = 0; state = 'docked'; path = null; if (link) { world.remove(link); link = null; } setLink(pos, toVec(tg.lat, tg.lon).normalize()); linkFade = 1;
  }
  function sailTo(tg, o = {}) {
    if (target && tg.id && target.id === tg.id && (state === 'sailing' || state === 'docked')) { if (state === 'docked') { o.onArrive && o.onArrive(tg); } else onArrive = o.onArrive || onArrive; return; }
    target = tg; onArrive = o.onArrive || null;
    const way = router && router.route(toLL(pos), tg);
    if (!way || way.length < 2 || reduce) { placeAt(tg); arrive(); return; }
    /* waypoints → vectors, rounded with three passes of corner cutting, then sampled every ~0.3 degrees along great circles */
    let pts = way.map((w) => toVec(w.lat, w.lon).normalize()); pts[0] = pos.clone();
    for (let it = 0; it < 3 && pts.length > 2; it++) { const o2 = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { o2.push(slerp(pts[i], pts[i + 1], 0.25), slerp(pts[i], pts[i + 1], 0.75)); } o2.push(pts[pts.length - 1]); pts = o2; }
    path = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(a.angleTo(b) / (0.3 * DEG))); for (let s = 1; s <= n; s++) path.push(slerp(a, b, s / n)); }
    cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i - 1].angleTo(path[i])); total = cum[cum.length - 1];
    dur = Math.max(1.8, Math.min(8, total / 0.42)); t = 0; state = 'sailing';
    if (link) linkFade = Math.min(linkFade, 0.99);
  }
  function at(dist) { let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= dist) lo = m; else hi = m; } const seg = cum[hi] - cum[lo] || 1; return slerp(path[lo], path[hi], (dist - cum[lo]) / seg); }

  let wakeClock = 0;
  function update(dt, tick, zoom) {
    if (state === 'sailing') {
      t += dt; const p = Math.min(1, t / dur); const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   /* ease in and out of port */
      const next = at(e * total); const ahead = at(Math.min(total, e * total + 0.6 * DEG));
      const dir = ahead.clone().sub(next); dir.sub(next.clone().multiplyScalar(dir.dot(next))); if (dir.lengthSq() > 1e-10) heading.lerp(dir.normalize(), Math.min(1, dt * 6));
      pos.copy(next);
      wakeClock += dt; if (wakeClock > 0.045) { wakeClock = 0; const stern = pos.clone().sub(heading.clone().multiplyScalar(LEN * 0.5 * (1 - 0.5 * zoom))).normalize().multiplyScalar(1.0016); wakePos.set([stern.x, stern.y, stern.z], wakeHead * 3); wakeHead = (wakeHead + 1) % W_N; wakeCount = Math.min(W_N, wakeCount + 1); }
      if (p >= 1) arrive();
    }
    /* the wake fades from the stern backwards, and away entirely in port */
    for (let i = 0; i < W_N; i++) { const age = (wakeHead - 1 - i + W_N) % W_N; wakeA[(wakeHead - 1 - age + W_N) % W_N] = 0; }
    for (let k2 = 0; k2 < wakeCount; k2++) { const idx = (wakeHead - 1 - k2 + W_N) % W_N; wakeA[idx] = Math.max(0, 1 - k2 / W_N) * (state === 'sailing' ? 1 : Math.max(0, 1 - linkFade)); }
    if (state === 'docked' && wakeCount) { linkFade = Math.min(1, linkFade + dt * 0.8); if (linkFade >= 1) wakeCount = 0; }
    wakeGeo.attributes.position.needsUpdate = true; wakeGeo.attributes.a.needsUpdate = true;
    linkMat.opacity = state === 'docked' ? 0.85 * Math.min(1, linkFade * 2) : Math.max(0, linkMat.opacity - dt * 3);
    if (link && linkMat.opacity <= 0 && state === 'sailing') { world.remove(link); link = null; }

    /* Shown at three-quarters, not straight down: the ship's "up" leans from the surface toward the top of the screen
       and toward the viewer, so its hull, containers and bridge read from the side. Its heading is the route's
       direction on screen; in port it turns to lie diagonally, bow to the upper right. */
    const up0 = pos.clone().normalize();
    const invW = world.quaternion.clone().invert();
    const camUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(invW);
    const camRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).applyQuaternion(invW);
    const shipW = up0.clone().applyQuaternion(world.quaternion);
    const toCam = camera.position.clone().sub(shipW).normalize().applyQuaternion(invW);
    const facing = toCam.dot(up0);
    const up = up0.clone().multiplyScalar(0.35).add(camUp.clone().multiplyScalar(0.62)).add(toCam.clone().multiplyScalar(0.45)).normalize();
    const diag = camRight.clone().multiplyScalar(0.78).add(camUp.clone().multiplyScalar(0.62));
    let want = heading.clone();
    const screenOf = (v) => v.clone().sub(toCam.clone().multiplyScalar(v.dot(toCam)));
    if (state === 'docked' || screenOf(want).length() < 0.25) want = diag; else { want = screenOf(want).normalize(); if (want.dot(camRight) < -0.2) want.add(camUp.clone().multiplyScalar(0.25)); }
    viewHeading.lerp(want, Math.min(1, dt * 3)).normalize();
    const fwd = viewHeading.clone().sub(up.clone().multiplyScalar(viewHeading.dot(up))).normalize(); const side = fwd.clone().cross(up);
    basis.makeBasis(fwd, up, side);
    model.material.opacity = Math.max(0, Math.min(1, (facing - 0.08) / 0.22));
    const roll = reduce ? 0 : Math.sin(tick * 1.6) * 0.035, pitch = reduce ? 0 : Math.sin(tick * 1.1 + 1) * 0.02;
    q.setFromRotationMatrix(basis); const bob = new Quaternion().setFromAxisAngle(fwd, roll).multiply(new Quaternion().setFromAxisAngle(side, pitch));
    /* phones draw the globe smaller, so the ship is drawn a size larger there */
    const sc = LEN * (1 - 0.5 * zoom) * ((opts.width ? opts.width() : 1000) < 700 ? 1.4 : 1);
    ship.matrix.compose(up0.clone().multiplyScalar(R), bob.multiply(q), new Vector3(sc, sc, sc)); ship.matrixWorldNeedsUpdate = true;
    if (rippleT >= 0) { rippleT += dt; const r = rippleT / 1.4; if (r >= 1) { rippleT = -1; ripple.material.opacity = 0; } else { ripple.position.copy(up0.clone().multiplyScalar(1.0014)); ripple.lookAt(up0.clone().multiplyScalar(2)); ripple.scale.setScalar(LEN * (0.4 + 1.2 * r) * (1 - 0.5 * zoom)); ripple.material.opacity = 0.7 * (1 - r); } }
    if (linkMat.resolution) linkMat.resolution.set(opts.width ? opts.width() : 1, opts.height ? opts.height() : 1);
  }
  return {
    update, sailTo, placeAt,
    get state() { return state; }, get target() { return target; },
    get normal() { return pos.clone().normalize(); }
  };
}
