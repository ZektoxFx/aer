// LOCAL DRAFT (Aiman): the crash, rendered in 3D (three.js) from the physics in edl.ts.
// Chase camera beside a 4.5 m entry capsule (dark ablative heat shield, light backshell):
//   entry: the air piles up in front of the heat shield into a glowing shock layer and a long ionised wake
//          (the "ball of fire"), lighting the capsule orange; sparks of burning shield stream off;
//   parachute: a 21.5 m canopy in orange and white gores, like Mars 2020's, snaps open, then tears away;
//   heat shield drops; retro-rockets sputter; the ground (the real HiRISE photo of Jezero, tinted, with
//          haze that thickens lower down) rushes up; impact: dust and pieces fly under Mars gravity (3.71 m/s²).
// The telemetry is the simulated run, sped up. Failures are game fiction. Colours come from the :root palette.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { AFTER_S, CRASH_RUN as RUN, CRASH_SEG as SEG, crashTime, edlAt, FLY_S, MARS_G } from './edl';

/** Metres of ground per repeat of the HiRISE tile (the map's photo covers about 6.4 km). */
const TILE_M = 6400;

function css(name: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(/^#[0-9a-f]{6}$/i.test(v) ? v : '#808080');
}
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

function softSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Glow shell: brightest where seen edge-on (fresnel), flickering, additive. */
function glowMaterial(color: THREE.Color, power: number) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color }, k: { value: 0 }, time: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float k; uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), ${power.toFixed(1)});
        float n = 0.75 + 0.25*sin(vP.y*3.0 - time*40.0 + sin(vP.x*5.0+time*13.0));
        gl_FragColor = vec4(color * (0.35 + f) * n, 1.0) * k; }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function CrashSequence({ active }: { active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLPreElement>(null);
  const cap = useRef<HTMLParagraphElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const dark = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !active) return;
    const C = {
      space: css('--space'), sky: css('--mars-sky'), sand: css('--mars-sand'), rust: css('--mars-rust'), shadow: css('--mars-shadow'),
      dust: css('--mars-dust'), metal: css('--metal'), metalDark: css('--metal-dark'), alarm: css('--alarm'), warn: css('--warning'),
    };
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3e6);

    // ---- Sky: black space high up, butterscotch dust near the ground, brighter toward the Sun ----
    const sunDir = new THREE.Vector3(-0.55, 0.32, 0.55).normalize();
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sun: { value: sunDir }, sunC: { value: C.dust } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 zen; uniform vec3 hor; uniform vec3 sun; uniform vec3 sunC; varying vec3 vD;
        void main(){ float h = clamp(vD.y, -0.2, 1.0); vec3 c = mix(hor, zen, smoothstep(-0.02, 0.45, h));
          float s = max(dot(normalize(vD), sun), 0.0); c += sunC * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2.5e6, 32, 16), skyMat);
    scene.add(sky);
    const starPts: number[] = [];
    for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.05, Math.random() - 0.5).normalize().multiplyScalar(2e6); starPts.push(v.x, v.y, v.z); }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3)),
      new THREE.PointsMaterial({ color: C.dust, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false, depthWrite: false }),
    );
    scene.add(stars);

    // ---- Ground: the real HiRISE Jezero photo, tinted, mirrored out to the horizon; haze hides the edge ----
    const tex = new THREE.TextureLoader().load('/data/jezero_base_2m.jpg');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const GROUND = 1.6e6;
    tex.repeat.set(GROUND / TILE_M, GROUND / TILE_M);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, GROUND), new THREE.MeshStandardMaterial({ map: tex, color: C.sand.clone().lerp(C.dust, 0.25), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    scene.fog = new THREE.Fog(C.sky, 1000, 50000);

    // ---- Light ----
    const sun = new THREE.DirectionalLight(C.dust, 2.6);
    scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(C.sky, C.rust, 0.5);
    scene.add(hemi);

    // ---- The capsule: 4.5 m across, 70° heat shield, conical backshell (local +y = from shield to backshell) ----
    const capsule = new THREE.Group();
    const shieldMat = new THREE.MeshStandardMaterial({ color: C.shadow.clone().lerp(C.rust, 0.35), roughness: 0.95, emissive: C.warn, emissiveIntensity: 0 });
    const shieldProfile = [[0, 0], [0.6, 0.05], [1.6, 0.32], [2.25, 0.56], [2.25, 0.64]].map(([r, y]) => new THREE.Vector2(r, y));
    const shield = new THREE.Mesh(new THREE.LatheGeometry(shieldProfile, 40), shieldMat);
    const backshell = new THREE.Mesh(
      new THREE.LatheGeometry([[2.2, 0.64], [1.9, 1.25], [1.2, 2.35], [0.95, 2.45], [0.9, 2.85], [0, 2.9]].map(([r, y]) => new THREE.Vector2(r, y)), 40),
      new THREE.MeshStandardMaterial({ color: C.metal, roughness: 0.45, metalness: 0.25 }),
    );
    capsule.add(shield, backshell);
    const shieldGlow = new THREE.PointLight(C.warn, 0, 60, 1.6);
    shieldGlow.position.set(0, -1.5, 0);
    capsule.add(shieldGlow);
    // Shock layer in front of the shield, and the ionised wake behind (both additive glows).
    const shockMat = glowMaterial(C.dust.clone().lerp(C.warn, 0.35), 1.4);
    const shock = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), shockMat);
    shock.scale.set(3.1, 1.6, 3.1); shock.position.y = 0.3;
    const wakeMat = glowMaterial(C.warn.clone().lerp(C.alarm, 0.4), 2.2);
    const wake = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 6, 60, 32, 8, true), wakeMat);
    capsule.add(shock, wake);
    // Burning bits of shield streaming back along the wake.
    const sprite = softSprite();
    const SPARKS = 400;
    const sparkPos = new Float32Array(SPARKS * 3), sparkV = new Float32Array(SPARKS);
    const resetSpark = (i: number, y0 = 0) => { const a = Math.random() * Math.PI * 2, r = 1.8 + Math.random() * 1.2; sparkPos[i * 3] = Math.cos(a) * r; sparkPos[i * 3 + 1] = y0; sparkPos[i * 3 + 2] = Math.sin(a) * r; sparkV[i] = 30 + Math.random() * 70; };
    for (let i = 0; i < SPARKS; i++) resetSpark(i, Math.random() * 80);
    const sparkGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({ map: sprite, color: C.dust, size: 0.9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.frustumCulled = false;
    capsule.add(sparks);
    // Retro-rocket plumes under the backshell (after the shield is gone).
    const plumeMat = glowMaterial(C.dust.clone().lerp(C.warn, 0.3), 1.2);
    const plumes = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.ConeGeometry(0.35, 6, 16, 1, true), plumeMat);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      p.position.set(Math.cos(a) * 1.5, -2.4, Math.sin(a) * 1.5); p.rotation.x = Math.PI;
      plumes.add(p);
    }
    capsule.add(plumes);
    scene.add(capsule);

    // ---- Parachute: 21.5 m canopy, orange and white gores (lines shortened a little to keep it in frame) ----
    const chute = new THREE.Group();
    const CR = 10.75, CAP = Math.PI * 0.42, LINE_TOP = 30;
    const canopyGeo = new THREE.SphereGeometry(CR, 48, 12, 0, Math.PI * 2, 0, CAP);
    {
      const pos = canopyGeo.attributes.position as THREE.BufferAttribute, colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i)), gore = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 20) % 2;
        const vent = pos.getY(i) / CR > 0.93;
        (gore || vent ? C.dust : C.alarm).toArray(colors, i * 3);
      }
      canopyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    canopy.position.y = LINE_TOP - CR * Math.cos(CAP); // rim sits at LINE_TOP
    const rimR = CR * Math.sin(CAP), linePts: THREE.Vector3[] = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; linePts.push(new THREE.Vector3(0, 3, 0), new THREE.Vector3(Math.cos(a) * rimR, LINE_TOP, Math.sin(a) * rimR)); }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePts), new THREE.LineBasicMaterial({ color: C.dust, transparent: true, opacity: 0.55 }));
    chute.add(canopy, lines);
    chute.visible = false;
    scene.add(chute);

    // ---- Impact: dust cloud and pieces thrown under Mars gravity ----
    const DUST = 700;
    const dustPos = new Float32Array(DUST * 3), dustVel = new Float32Array(DUST * 3);
    const dustGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ map: sprite, color: C.sand.clone().lerp(C.dust, 0.35), size: 7, transparent: true, opacity: 0, depthWrite: false });
    const dustCloud = new THREE.Points(dustGeo, dustMat);
    dustCloud.frustumCulled = false;
    scene.add(dustCloud);
    const debris: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3 }[] = [];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2 + Math.random() * 1.2, 0.05, 0.2 + Math.random() * 0.8), new THREE.MeshStandardMaterial({ color: Math.random() < 0.6 ? C.metal : C.metalDark, roughness: 0.5, metalness: 0.4 }));
      m.visible = false; scene.add(m);
      debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
    }
    const droppedShield = new THREE.Mesh(shield.geometry, shieldMat);
    droppedShield.visible = false;
    scene.add(droppedShield);
    let shieldDrop: { y: number; vy: number; x: number } | null = null;

    // ---- Size ----
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el); resize();

    // ---- Loop ----
    const t0 = performance.now();
    let last = t0, raf = 0, alive = true, impactAt = -1, tumble = 0, chuteGone = 0;
    const hor = new THREE.Color(), zen = new THREE.Color(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), vdir = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0), camPos = new THREE.Vector3(), jitter = new THREE.Vector3(), look = new THREE.Vector3(), eu = new THREE.Euler();
    const skyDim = C.sky.clone().multiplyScalar(0.55), horDim = C.sky.clone().multiplyScalar(0.35);

    function frame(now: number) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const T = (now - t0) / 1000;
      const { t, seg, f } = crashTime(T);
      const s = edlAt(RUN, t);
      const impacted = T >= FLY_S;
      if (impacted && impactAt < 0) {
        impactAt = T;
        for (let i = 0; i < DUST; i++) {
          const a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 30;
          dustPos.set([Math.cos(a) * 2, 0.5, Math.sin(a) * 2], i * 3);
          dustVel.set([Math.cos(a) * sp, 2 + Math.random() * 10, Math.sin(a) * sp], i * 3);
        }
        debris.forEach((d) => { const a = Math.random() * Math.PI * 2, sp = 8 + Math.random() * 22; d.m.position.set(0, 1.5, 0); d.v.set(Math.cos(a) * sp, 6 + Math.random() * 16, Math.sin(a) * sp); d.m.visible = true; });
      }
      const since = impacted ? T - impactAt : 0;
      const alt = impacted ? 0 : s.h;
      const u = clamp(Math.log10(Math.max(alt, 1)) / Math.log10(125_000));

      // Air and light change with height: thin and black above, hazy butterscotch below.
      zen.copy(C.space).lerp(skyDim, Math.pow(1 - u, 1.6));
      hor.copy(horDim).lerp(C.sky, Math.pow(1 - u, 0.8));
      skyMat.uniforms.zen.value.copy(zen); skyMat.uniforms.hor.value.copy(hor);
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(hor); fog.far = 12_000 + alt * 4; fog.near = 200 + alt * 0.3;
      (stars.material as THREE.PointsMaterial).opacity = clamp((u - 0.55) * 2.5) * 0.85;
      hemi.intensity = 0.25 + 0.6 * (1 - u);

      // The capsule stays at x = 0; the ground slides under it (texture offset = distance flown downrange).
      tex.offset.set((s.x % (TILE_M * 2)) / TILE_M, 0);
      capsule.position.set(0, impacted ? 1.2 : Math.max(alt, 2.2), 0);

      // Attitude: heat shield into the airflow during entry; hanging under the chute; tumbling once it tears.
      vdir.set(s.vx, s.vh, 0).normalize();
      if (seg === 0) q.setFromUnitVectors(down, vdir);
      else if (s.chute === 'open') q.setFromEuler(eu.set(Math.sin(T * 5) * 0.08, 0, Math.sin(T * 3.3) * 0.1));
      else if (!impacted) { tumble += dt * (s.thrust ? 0.5 : 1.6); q.setFromEuler(eu.set(Math.sin(tumble * 1.7) * 0.35, tumble * 0.4, Math.sin(tumble * 2.3) * 0.3)); }
      else q.setFromEuler(eu.set(0, 0.4, Math.min(1.2, since * 3)));
      if (seg === 0) capsule.quaternion.copy(q); else capsule.quaternion.slerp(q, impacted ? 0.3 : 0.15);

      // Ball of fire: brightness follows the simulated heating.
      const heat = impacted ? 0 : s.heat;
      shockMat.uniforms.k.value = heat * 1.6; shockMat.uniforms.time.value = T;
      wakeMat.uniforms.k.value = heat * 0.9; wakeMat.uniforms.time.value = T;
      wake.scale.set(1, 0.4 + heat * 0.9, 1); wake.position.y = 3 + 30 * wake.scale.y;
      shieldGlow.intensity = heat * 900;
      shieldMat.emissiveIntensity = heat * 1.2;
      sparkMat.opacity = Math.min(1, heat * 1.4);
      if (heat > 0.01) {
        for (let i = 0; i < SPARKS; i++) { sparkPos[i * 3 + 1] += sparkV[i] * dt * (0.5 + heat); if (sparkPos[i * 3 + 1] > 70) resetSpark(i); }
        sparkGeo.attributes.position.needsUpdate = true;
      }

      // Parachute: opens fast, holds, then tears away (it rises off as the capsule falls on without it).
      if (seg >= 1 && !impacted) {
        chute.visible = true;
        const open = seg === 1 ? clamp(f * 4) : 1;
        canopy.scale.setScalar(0.15 + 0.85 * open);
        if (seg >= 2) chuteGone += dt;
        chute.position.set(capsule.position.x - chuteGone * 25, capsule.position.y + chuteGone * 60, chuteGone * 10);
        chute.rotation.set(chuteGone * 0.8, 0, Math.sin(T * 2) * 0.05 + chuteGone * 0.6);
        lines.visible = seg === 1;
        if (chuteGone > 2.5) chute.visible = false;
      } else chute.visible = false;
      // Heat shield drops away soon after the chute opens, falling under gravity.
      if (seg === 1 && f > 0.4 && !shieldDrop) { shieldDrop = { y: capsule.position.y - 1.5, vy: 0, x: 0 }; shield.visible = false; droppedShield.visible = true; }
      if (shieldDrop) {
        shieldDrop.vy -= MARS_G * 10 * dt; shieldDrop.y += shieldDrop.vy * dt; shieldDrop.x += dt * 2;
        droppedShield.position.set(shieldDrop.x, Math.max(0.3, shieldDrop.y), 1);
        droppedShield.rotation.x += dt * 0.7;
        if (shieldDrop.y < capsule.position.y - 400) droppedShield.visible = false;
      }
      // Retro-rockets: on only when the simulation fires them (the damaged engine stutters).
      plumes.visible = s.thrust && !impacted;
      plumeMat.uniforms.k.value = 1.4; plumeMat.uniforms.time.value = T;
      plumes.scale.set(1, 0.7 + Math.random() * 0.6, 1);

      // Impact: dust and pieces fly under Mars gravity, the dust slowed by the thin air.
      if (impacted) {
        dustMat.opacity = Math.max(0, 0.85 - since * 0.25);
        for (let i = 0; i < DUST; i++) {
          for (let k = 0; k < 3; k++) { dustVel[i * 3 + k] *= 1 - dt * 0.9; dustPos[i * 3 + k] += dustVel[i * 3 + k] * dt; }
          dustVel[i * 3 + 1] -= MARS_G * 0.3 * dt;
          if (dustPos[i * 3 + 1] < 0.3) dustPos[i * 3 + 1] = 0.3;
        }
        dustGeo.attributes.position.needsUpdate = true;
        dustMat.size = 7 + since * 6;
        for (const d of debris) {
          if (!d.m.visible) continue;
          d.v.y -= MARS_G * dt;
          d.m.position.addScaledVector(d.v, dt);
          d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt;
          if (d.m.position.y < 0.05) { d.m.position.y = 0.05; d.v.multiplyScalar(0.3); d.v.y = Math.abs(d.v.y) * 0.4; }
        }
      }

      // Camera: beside and behind during entry; further out under the chute; above as the ground comes up.
      const shake = Math.min(1.2, s.gLoad * 0.12 + heat * 0.25) + (impacted ? 2.5 * Math.exp(-since * 3) : 0);
      if (seg === 0) camPos.set(-16, 5, 22).applyAxisAngle(up, Math.sin(T * 0.3) * 0.15);
      else if (s.chute === 'open') camPos.set(-26, 6, 40);
      else if (!impacted) camPos.set(-18, 14, 26);
      else camPos.set(-24, 7, 34);
      jitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake);
      camera.position.copy(capsule.position).add(camPos).add(jitter);
      if (camera.position.y < 2) camera.position.y = 2;
      look.copy(capsule.position);
      if (s.chute === 'open') look.y += 12;
      if (!impacted && seg >= 2) look.y -= 4;
      camera.lookAt(look);
      sky.position.copy(camera.position);
      stars.position.copy(camera.position);
      sun.target.position.copy(capsule.position);
      sun.position.copy(capsule.position).addScaledVector(sunDir, 100);

      // Overlays: telemetry, what is happening, the impact flash, and the fade to black (eyes shut).
      if (hud.current) {
        hud.current.textContent = [
          `ALT     ${alt >= 10_000 ? (alt / 1000).toFixed(1) : (alt / 1000).toFixed(2)} km`,
          `SPEED   ${s.v >= 1000 && !impacted ? `${(s.v / 1000).toFixed(2)} km/s` : `${Math.round(impacted ? 0 : s.v)} m/s`}`,
          `DECEL   ${(impacted ? 0 : s.gLoad).toFixed(1)} g`,
          `HEATING ${Math.round(heat * 100)}%`,
          `GRAVITY ${MARS_G} m/s²   T+${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
        ].join('\n');
      }
      if (cap.current) {
        const label = impacted ? '▲ IMPACT' : SEG[Math.min(seg, SEG.length - 1)].label + (seg === 0 && heat > 0.6 ? ': PEAK HEATING' : '');
        cap.current.textContent = label;
        cap.current.dataset.alert = label.startsWith('▲') ? '1' : '0';
      }
      if (flash.current) flash.current.style.opacity = impacted ? String(Math.max(0, 0.85 - since * 2)) : '0';
      if (dark.current) dark.current.style.opacity = impacted ? String(clamp((since - 0.8) / (AFTER_S - 0.9))) : '0';

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => x.dispose());
      });
      tex.dispose(); sprite.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active]);

  return (
    <div ref={host} className="crash-seq" aria-hidden="true">
      <pre ref={hud} className="crash-hud" />
      <p ref={cap} className="crash-cap" />
      <p className="crash-note">SIMULATED DESCENT · physics sped up ~50× · failures are game fiction</p>
      <div ref={flash} className="crash-flash" />
      <div ref={dark} className="crash-dark" />
    </div>
  );
}
