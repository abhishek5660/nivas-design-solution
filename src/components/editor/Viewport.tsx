'use client';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { materialIndex } from '@/lib/catalog';
import { buildParts, checkPlacement, footprint, resizeNode, snapNode, validateNode } from '@/lib/scene';
import { nodeLocalBounds, roomBox, sceneBounds } from '@/lib/three/bounds';
import type { SceneDoc, SceneNode, Vec3 } from '@/lib/types';
import { descendants, topAncestor, useEditor } from '@/store/editor';
import { thumbnailProvider } from '@/store/save';
import { ModelMesh, NodeParts } from './NodeView';
import { RoomMesh } from './RoomMesh';
import { nodeShownInPlan, PlanLights, PlanMesh } from '../plan/PlanMesh';
import { usePlanUi } from '@/store/planUi';

const M = 0.001; // mm → scene metres

/** Imperative bridge between the DOM UI (library drag-drop, render dialog) and the canvas. */
export const viewportApi: {
  floorPoint: null | ((x: number, y: number) => [number, number] | null);
  gl: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.Camera | null;
  setPose: null | ((pos: [number, number, number], target: [number, number, number]) => void);
  pause: null | ((paused: boolean) => void);
  getPose: null | (() => { pos: [number, number, number]; target: [number, number, number] });
} = { floorPoint: null, gl: null, scene: null, camera: null, setPose: null, getPose: null, pause: null };

// ---------- environment & lights ----------
const PRESETS = {
  daylight: { bg: '#dce6ee', sun: '#fff1da', sunI: 2.6, hemi: 0.9, env: 1.0, warm: 0 },
  warm: { bg: '#e9dccb', sun: '#ffc88a', sunI: 1.3, hemi: 0.55, env: 0.55, warm: 1 },
  neutral: { bg: '#e8e5df', sun: '#ffffff', sunI: 2.0, hemi: 0.8, env: 0.85, warm: 0 },
  night: { bg: '#15171d', sun: '#8fa6ff', sunI: 0.35, hemi: 0.25, env: 0.18, warm: 0.5 },
} as const;

function Env({ intensity }: { intensity: number }) {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = tex;
    invalidate();
    return () => {
      scene.environment = null;
      tex.dispose();
      pm.dispose();
    };
  }, [gl, scene, invalidate]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
    invalidate();
  }, [scene, intensity, invalidate]);
  return null;
}

const TONE: Record<string, THREE.ToneMapping> = { ACES: THREE.ACESFilmicToneMapping, AgX: THREE.AgXToneMapping, Neutral: THREE.NeutralToneMapping, None: THREE.NoToneMapping };

function Lights({ doc, ledPositions }: { doc: SceneDoc; ledPositions: { p: Vec3; color: string; i: number }[] }) {
  const { gl, scene, invalidate } = useThree();
  const L = doc.lighting;
  const pr = PRESETS[L.preset];
  const rb = roomBox(doc);
  const cx = (rb.min[0] + rb.max[0]) / 2 * M;
  const cz = (rb.min[2] + rb.max[2]) / 2 * M;
  const span = Math.max(rb.max[0] - rb.min[0], rb.max[2] - rb.min[2]) * M;
  const h = (doc.plan?.enabled ? rb.max[1] : doc.room.height) * M;
  useEffect(() => {
    gl.toneMapping = TONE[L.toneMapping] ?? THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = L.exposure;
    gl.shadowMap.enabled = L.shadows;
    gl.shadowMap.type = THREE.PCFShadowMap;
    scene.background = new THREE.Color(pr.bg);
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true)); // shadow/tone-mapping changes need a program refresh
    });
    invalidate();
  }, [gl, scene, invalidate, L.toneMapping, L.exposure, L.shadows, pr.bg]);
  const sun = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
  }, [cx, cz]);
  return (
    <>
      <Env intensity={pr.env} />
      <hemisphereLight args={['#ffffff', '#b9a98f', pr.hemi * L.roomLight]} />
      <directionalLight
        ref={sun}
        color={pr.sun}
        intensity={pr.sunI}
        position={[cx + span * 0.8, h * 2.2, cz + span * 0.9]}
        castShadow={L.shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.015}
        shadow-radius={5}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-near={0.1}
        shadow-camera-far={span * 8}
      />
      {pr.warm > 0 && <pointLight color="#ffcf9a" intensity={2.2 * pr.warm * L.roomLight} distance={span * 3} decay={1.6} position={[cx, h * 0.92, cz]} />}
      {ledPositions.map((l, i) => (
        <pointLight key={i} color={l.color} intensity={0.35 * l.i * (L.preset === 'night' ? 3 : 1)} distance={2.4} decay={2} position={[l.p[0] * M, l.p[1] * M, l.p[2] * M]} />
      ))}
    </>
  );
}

// ---------- camera ----------
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function viewDirection(type: string): THREE.Vector3 {
  switch (type) {
    case 'front': return new THREE.Vector3(0, 0.05, 1);
    case 'back': return new THREE.Vector3(0, 0.05, -1);
    case 'left': return new THREE.Vector3(-1, 0.05, 0);
    case 'right': return new THREE.Vector3(1, 0.05, 0);
    case 'top': return new THREE.Vector3(0, 1, 0.0001);
    default: return new THREE.Vector3(0.75, 0.62, 0.95);
  }
}

function CameraRig({ doc, walk }: { doc: SceneDoc; walk: boolean }) {
  const ui = useEditor((s) => s.ui);
  const viewRequest = useEditor((s) => s.viewRequest);
  const { camera, size, controls, invalidate } = useThree();
  const anim = useRef<null | { t: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromZoom: number; toZoom: number }>(null);
  const initial = useRef(false);

  const compute = useCallback(
    (type: string) => {
      const st = useEditor.getState();
      const sel = st.sel.ids;
      const bx = type === 'fit-selection' && sel.length ? sceneBounds(st.doc, sel.flatMap((i) => descendants(st.doc, [i]))) : type === 'fit-scene' || type === 'reset' ? { min: [...roomBox(st.doc).min] as Vec3, max: [...roomBox(st.doc).max] as Vec3 } : sceneBounds(st.doc);
      const room = roomBox(st.doc);
      const useRoom = type === 'iso' || type === 'reset' || type === 'fit-scene';
      const b = useRoom ? room : bx;
      const center = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2).multiplyScalar(M);
      const ext = new THREE.Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]).multiplyScalar(M);
      const radius = Math.max(0.6, ext.length() / 2);
      const dir = viewDirection(type === 'fit-selection' || type === 'fit-scene' || type === 'reset' ? 'iso' : type);
      if (type === 'front' || type === 'back') {
        // frame the facade, not the whole bounding sphere
        const fit = Math.max(ext.x / (camera instanceof THREE.PerspectiveCamera ? Math.max(0.4, size.width / size.height) : 1), ext.y);
        const dist = camera instanceof THREE.PerspectiveCamera ? (fit * 0.62) / Math.tan((camera.fov * Math.PI) / 360) + ext.z / 2 : 8;
        return { pos: center.clone().add(dir.clone().normalize().multiplyScalar(Math.max(dist, 1.2))), target: center, zoom: size.height / (fit * 1.3) };
      }
      const dist = camera instanceof THREE.PerspectiveCamera ? (radius * 1.15) / Math.tan((camera.fov * Math.PI) / 360) : 10;
      return { pos: center.clone().add(dir.normalize().multiplyScalar(dist)), target: center, zoom: size.height / (radius * 2.3) };
    },
    [camera, size],
  );

  const goTo = useCallback(
    (type: string, instant = false) => {
      const c = compute(type);
      const ctl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
      const ortho = camera instanceof THREE.OrthographicCamera;
      if (instant || !ctl) {
        camera.position.copy(c.pos);
        ctl?.target.copy(c.target);
        camera.lookAt(c.target);
        if (ortho) {
          (camera as THREE.OrthographicCamera).zoom = c.zoom;
          camera.updateProjectionMatrix();
        }
        ctl?.update();
        return;
      }
      anim.current = { t: 0, fromPos: camera.position.clone(), toPos: c.pos, fromTarget: ctl.target.clone(), toTarget: c.target, fromZoom: ortho ? (camera as THREE.OrthographicCamera).zoom : 1, toZoom: c.zoom };
    },
    [camera, compute, controls],
  );

  useEffect(() => {
    if (!initial.current && controls) {
      initial.current = true;
      goTo('iso', true);
    }
  }, [controls, goTo]);

  useEffect(() => {
    if (viewRequest) {
      goTo(viewRequest.type);
      invalidate();
    }
  }, [viewRequest, goTo, invalidate]);

  // when switching projection, snap to a sensible framing
  useEffect(() => {
    if (initial.current) goTo('iso', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.camera]);

  useFrame((_, dt) => {
    const a = anim.current;
    const ctl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!a || !ctl) return;
    a.t = Math.min(1, a.t + dt / 0.65);
    const k = ease(a.t);
    camera.position.lerpVectors(a.fromPos, a.toPos, k);
    ctl.target.lerpVectors(a.fromTarget, a.toTarget, k);
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = a.fromZoom + (a.toZoom - a.fromZoom) * k;
      camera.updateProjectionMatrix();
    }
    ctl.update();
    if (a.t >= 1) anim.current = null;
    else invalidate();
  });

  if (walk) return null;
  return (
    <>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.09}
        maxPolarAngle={ui.camera === 'orthographic' ? Math.PI : Math.PI * 0.495}
        minDistance={0.3}
        maxDistance={40}
        autoRotate={ui.presentation}
        autoRotateSpeed={1.2}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        onStart={() => (anim.current = null)}
      />
      {/* keep `doc` in deps so framing refreshes after room resize */}
      <group visible={false} userData={{ room: doc.room.points.length }} />
    </>
  );
}

function WalkControls({ doc }: { doc: SceneDoc }) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const yaw = useRef(0);
  const pitch = useRef(0);
  useEffect(() => {
    const rb = roomBox(doc);
    camera.position.set(((rb.min[0] + rb.max[0]) / 2) * M, 1.6, (rb.max[2] - 400) * M);
    yaw.current = 0;
    pitch.current = 0;
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      keys.current[e.key.toLowerCase()] = true;
    };
    const up = (e: KeyboardEvent) => (keys.current[e.key.toLowerCase()] = false);
    let dragging = false;
    const pd = () => (dragging = true);
    const pu = () => (dragging = false);
    const pm = (e: PointerEvent) => {
      if (!dragging) return;
      yaw.current -= e.movementX * 0.004;
      pitch.current = Math.max(-1.2, Math.min(1.2, pitch.current - e.movementY * 0.004));
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    gl.domElement.addEventListener('pointerdown', pd);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointermove', pm);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      gl.domElement.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointermove', pm);
    };
  }, [camera, gl, doc]);
  useFrame((_, dt) => {
    const k = keys.current;
    const speed = (k['shift'] ? 3.2 : 1.4) * dt;
    const fwd = (k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 1 : 0);
    const str = (k['d'] || k['arrowright'] ? 1 : 0) - (k['a'] || k['arrowleft'] ? 1 : 0);
    camera.position.x += (-Math.sin(yaw.current) * fwd + Math.cos(yaw.current) * str) * speed;
    camera.position.z += (-Math.cos(yaw.current) * fwd - Math.sin(yaw.current) * str) * speed;
    camera.position.y = 1.6;
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch.current, yaw.current, 0);
  });
  return null;
}

// ---------- floor plane intersection helper ----------
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

type DragState =
  | { mode: 'move'; ids: string[]; primary: string; start: [number, number]; startNodes: Record<string, SceneNode>; moved: boolean }
  | { mode: 'rotate'; ids: string[]; primary: string; startAngle: number; startNodes: Record<string, SceneNode>; moved: boolean; center: [number, number] }
  | { mode: 'resize'; id: string; axis: 'x+' | 'x-' | 'y+' | 'z+' | 'z-'; startNode: SceneNode; startT: number; moved: boolean };

function SceneContent() {
  const doc = useEditor((s) => s.doc);
  const ui = useEditor((s) => s.ui);
  const sel = useEditor((s) => s.sel);
  const hovered = useEditor((s) => s.hovered);
  const { gl, camera, scene, size } = useThree();
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const explodedRef = useRef(0);
  const drag = useRef<DragState | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const matIdx = useMemo(() => materialIndex(doc.customMaterials), [doc.customMaterials]);
  const ctx = useMemo(() => ({ doc, matIdx }), [doc, matIdx]);
  const walk = ui.walkthrough;
  // re-bake contact shadows when the design changes (but not on every frame of a drag)
  const inTx = useEditor((s) => !!s.tx);
  const bake = useRef(0);
  const lastDoc = useRef(doc);
  if (lastDoc.current !== doc && !inTx) {
    bake.current += 1;
    lastDoc.current = doc;
  }

  // On-demand rendering: draw a frame whenever editor state changes, textures finish loading, or an animation is running.
  useEffect(() => {
    const unsub0 = usePlanUi.subscribe((s, prev) => { if (s.selection !== prev.selection || s.floorMode !== prev.floorMode) invalidate(); }); // not on every cursor move
    const unsub1 = useEditor.subscribe(() => invalidate());
    const unsub = () => { unsub0(); unsub1(); };
    const onTex = () => invalidate();
    window.addEventListener('nivas-invalidate', onTex);
    return () => {
      unsub();
      window.removeEventListener('nivas-invalidate', onTex);
    };
  }, [invalidate]);
  const live = ui.presentation || ui.walkthrough;

  // exploded animation (keeps requesting frames until it settles)
  useFrame((_, dt) => {
    const target = useEditor.getState().ui.exploded;
    const before = explodedRef.current;
    explodedRef.current += (target - explodedRef.current) * Math.min(1, dt * 4);
    if (Math.abs(target - explodedRef.current) < 0.002) explodedRef.current = target;
    if (explodedRef.current !== before || live) invalidate();
  });

  // thumbnail provider
  useEffect(() => {
    thumbnailProvider.current = () => {
      gl.render(scene, camera);
      const src = gl.domElement;
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 300;
      const ctx2 = c.getContext('2d');
      if (!ctx2 || !src.width) return null;
      const ar = src.width / src.height;
      const tar = c.width / c.height;
      let sw = src.width, sh = src.height, sx = 0, sy = 0;
      if (ar > tar) { sw = src.height * tar; sx = (src.width - sw) / 2; } else { sh = src.width / tar; sy = (src.height - sh) / 2; }
      ctx2.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    };
    return () => {
      thumbnailProvider.current = null;
    };
  }, [gl, scene, camera]);

  const floorPoint = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(FLOOR, hit) ? [hit.x / M, hit.z / M] : null;
    },
    [gl, camera, raycaster],
  );

  const rayAxisParam = useCallback(
    (clientX: number, clientY: number, p: THREE.Vector3, u: THREE.Vector3): number | null => {
      const r = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      const o = raycaster.ray.origin;
      const d = raycaster.ray.direction;
      const w0 = o.clone().sub(p);
      const b = d.dot(u);
      const dd = d.dot(w0);
      const e = u.dot(w0);
      const denom = 1 - b * b;
      if (Math.abs(denom) < 1e-5) return null;
      return (e - b * dd) / denom / M; // mm along u
    },
    [gl, camera, raycaster],
  );

  useEffect(() => {
    viewportApi.floorPoint = floorPoint;
    viewportApi.gl = gl;
    viewportApi.scene = scene;
    viewportApi.camera = camera;
    viewportApi.getPose = () => {
      const t = (controls as unknown as { target: THREE.Vector3 } | null)?.target ?? new THREE.Vector3();
      return { pos: camera.position.toArray() as [number, number, number], target: t.toArray() as [number, number, number] };
    };
    viewportApi.pause = (paused: boolean) => {
      setFrameloop(paused ? 'never' : 'demand');
      if (!paused) setTimeout(() => invalidate(), 0);
    };
    viewportApi.setPose = (pos, target) => {
      const ctl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
      camera.position.set(...pos);
      ctl?.target.set(...target);
      ctl?.update();
    };
    return () => {
      viewportApi.floorPoint = null;
      viewportApi.gl = null;
      viewportApi.scene = null;
      viewportApi.camera = null;
      viewportApi.getPose = null;
      viewportApi.pause = null;
      viewportApi.setPose = null;
    };
  }, [floorPoint, gl, scene, camera, controls, setFrameloop, invalidate]);

  // global pointer listeners while dragging
  useEffect(() => {
    const dom = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const st = useEditor.getState();
      if (d.mode === 'move') {
        const pt = floorPoint(e.clientX, e.clientY);
        if (!pt) return;
        const dx = pt[0] - d.start[0];
        const dz = pt[1] - d.start[1];
        if (!d.moved && Math.hypot(dx, dz) < 12) return;
        if (!d.moved) {
          d.moved = true;
          st.beginTx();
        }
        const prim = d.startNodes[d.primary];
        const snapped = snapNode(st.doc, prim, [prim.position[0] + dx, prim.position[1], prim.position[2] + dz], prim.rotationY, st.ui.snap || null, !e.altKey);
        const sdx = snapped.position[0] - prim.position[0];
        const sdz = snapped.position[2] - prim.position[2];
        const rotD = snapped.rotationY - prim.rotationY;
        st.preview((doc0) => {
          const nodes = { ...doc0.nodes };
          for (const id of d.ids) {
            const n = d.startNodes[id];
            if (!n) continue;
            nodes[id] = { ...n, position: [n.position[0] + sdx, n.position[1], n.position[2] + sdz], rotationY: id === d.primary && d.ids.length === 1 ? snapped.rotationY : n.rotationY };
            void rotD;
          }
          return { ...doc0, nodes };
        });
      } else if (d.mode === 'rotate') {
        const pt = floorPoint(e.clientX, e.clientY);
        if (!pt) return;
        const ang = (Math.atan2(pt[0] - d.center[0], pt[1] - d.center[1]) * 180) / Math.PI;
        let delta = ang - d.startAngle;
        if (!e.shiftKey) delta = Math.round(delta / 15) * 15;
        if (!d.moved && Math.abs(delta) < 1) return;
        if (!d.moved) {
          d.moved = true;
          st.beginTx();
        }
        const rad = (-delta * Math.PI) / 180;
        st.preview((doc0) => {
          const nodes = { ...doc0.nodes };
          for (const id of d.ids) {
            const n = d.startNodes[id];
            if (!n) continue;
            const ox = n.position[0] - d.center[0];
            const oz = n.position[2] - d.center[1];
            nodes[id] = { ...n, rotationY: ((n.rotationY - delta + 540) % 360) - 180, position: [d.center[0] + ox * Math.cos(rad) + oz * Math.sin(rad), n.position[1], d.center[1] - ox * Math.sin(rad) + oz * Math.cos(rad)] };
          }
          return { ...doc0, nodes };
        });
      } else {
        const n0 = d.startNode;
        const th = (n0.rotationY * Math.PI) / 180;
        const ax = d.axis;
        const u = ax.startsWith('x') ? new THREE.Vector3(Math.cos(th), 0, -Math.sin(th)) : ax.startsWith('z') ? new THREE.Vector3(Math.sin(th), 0, Math.cos(th)) : new THREE.Vector3(0, 1, 0);
        const sign = ax.endsWith('-') ? -1 : 1;
        const faceLocal: Vec3 = ax.startsWith('x') ? [(sign * n0.size.w) / 2, n0.size.h / 2, 0] : ax.startsWith('z') ? [0, n0.size.h / 2, (sign * n0.size.d) / 2] : [0, n0.size.h, 0];
        const wp = new THREE.Vector3(n0.position[0] + faceLocal[0] * Math.cos(th) + faceLocal[2] * Math.sin(th), n0.position[1] + faceLocal[1], n0.position[2] - faceLocal[0] * Math.sin(th) + faceLocal[2] * Math.cos(th)).multiplyScalar(M);
        const t = rayAxisParam(e.clientX, e.clientY, wp, u);
        if (t == null) return;
        if (!d.moved) {
          d.startT = t;
          d.moved = true;
          st.beginTx();
        }
        let delta = (t - d.startT) * sign;
        if (st.ui.snap) delta = Math.round(delta / st.ui.snap) * st.ui.snap;
        const size = { ...n0.size };
        if (ax.startsWith('x')) size.w = n0.size.w + delta;
        else if (ax.startsWith('z')) size.d = n0.size.d + delta;
        else size.h = n0.size.h + delta;
        if (size.w < 20 || size.h < 20 || size.d < 20) return;
        const resized = resizeNode(n0, size);
        if (validateNode(resized).some((i) => i.level === 'error')) return;
        const shift = ax.startsWith('y') ? 0 : delta / 2;
        const sv = ax.startsWith('x') ? new THREE.Vector3(Math.cos(th), 0, -Math.sin(th)) : new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
        const next: SceneNode = { ...resized, position: [n0.position[0] + sv.x * shift * sign, n0.position[1], n0.position[2] + sv.z * shift * sign] };
        st.preview((doc0) => ({ ...doc0, nodes: { ...doc0.nodes, [n0.id]: next } }));
      }
    };
    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      if (controls) controls.enabled = true;
      if (!d) return;
      const st = useEditor.getState();
      if (d.moved) {
        const ids = d.mode === 'resize' ? [d.id] : d.ids;
        st.endTx({ validateIds: ids });
      } else st.cancelTx();
    };
    dom.addEventListener('pointermove', onMove);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, floorPoint, rayAxisParam, controls]);

  const onNodeDown = useCallback(
    (e: ThreeEvent<PointerEvent>, node: SceneNode) => {
      if (e.button !== 0 || walk) return;
      e.stopPropagation();
      const st = useEditor.getState();
      const top = topAncestor(st.doc, node.id);
      if (e.shiftKey) st.select([top], true);
      else if (!st.sel.ids.includes(top)) st.select([top]);
      // sub-selection from the clicked triangle
      let sub: { kind: string; index: number } | null = null;
      const obj = e.object as THREE.Mesh & { userData: { sub?: { kind: string; index: number }; ranges?: { end: number; sub?: { kind: string; index: number } }[] } };
      const ud = obj.userData;
      if (ud.ranges && e.faceIndex != null) {
        const idx = e.faceIndex * 3;
        sub = ud.ranges.find((r) => idx < r.end)?.sub ?? null;
      } else if (ud.sub) sub = ud.sub;
      st.selectSub(sub);
      if (st.access === 'VIEW') return;
      const nodes = st.doc.nodes;
      if (nodes[top].locked) {
        st.toast('info', `${nodes[top].name} is locked. Unlock it to move it.`);
        return;
      }
      const pt = floorPoint(e.nativeEvent.clientX, e.nativeEvent.clientY);
      if (!pt) return;
      const ids = descendants(st.doc, useEditor.getState().sel.ids).filter((i) => !nodes[i].locked);
      const startNodes: Record<string, SceneNode> = {};
      ids.forEach((i) => (startNodes[i] = nodes[i]));
      if (controls) controls.enabled = false;
      if (st.ui.tool === 'rotate') {
        const c: [number, number] = [nodes[top].position[0], nodes[top].position[2]];
        drag.current = { mode: 'rotate', ids, primary: top, startAngle: (Math.atan2(pt[0] - c[0], pt[1] - c[1]) * 180) / Math.PI, startNodes, moved: false, center: c };
      } else drag.current = { mode: 'move', ids, primary: top, start: pt, startNodes, moved: false };
    },
    [controls, floorPoint, walk],
  );

  const onNodeDouble = useCallback((e: ThreeEvent<MouseEvent>, node: SceneNode) => {
    e.stopPropagation();
    const g = (e.object as THREE.Object3D).userData.group as string | undefined;
    if (g) useEditor.getState().toggleOpen(node.id, g);
  }, []);

  const startResize = useCallback(
    (e: ThreeEvent<PointerEvent>, node: SceneNode, axis: 'x+' | 'x-' | 'y+' | 'z+' | 'z-') => {
      e.stopPropagation();
      if (useEditor.getState().access === 'VIEW') return;
      if (controls) controls.enabled = false;
      drag.current = { mode: 'resize', id: node.id, axis, startNode: node, startT: 0, moved: false };
    },
    [controls],
  );

  // LED glow lights: sample a handful of emissive parts
  const ledPositions = useMemo(() => {
    const out: { p: Vec3; color: string; i: number }[] = [];
    for (const id of doc.order) {
      const n = doc.nodes[id];
      if (!n?.visible) continue;
      const leds = buildParts(n).filter((p) => p.light && p.light.intensity > 0);
      const stride = Math.max(1, Math.ceil(leds.length / 3));
      for (let i = 0; i < leds.length; i += stride) {
        const p = leds[i];
        const th = (n.rotationY * Math.PI) / 180;
        const c = p.center;
        out.push({ p: [n.position[0] + c[0] * Math.cos(th) + c[2] * Math.sin(th), n.position[1] + c[1], n.position[2] - c[0] * Math.sin(th) + c[2] * Math.cos(th) + 0], color: p.light!.color, i: p.light!.intensity });
      }
    }
    return out.slice(0, 10);
  }, [doc]);

  const planSel = usePlanUi((s) => s.selection);
  const floorMode = usePlanUi((s) => s.floorMode);
  const visibleNodes = doc.order.map((id) => doc.nodes[id]).filter((n): n is SceneNode => !!n && n.visible && n.type !== 'group' && (!doc.plan?.enabled || nodeShownInPlan(doc.plan, n.floorId, floorMode)));
  const selSet = new Set(sel.ids.flatMap((i) => descendants(doc, [i])));
  const collisions = useMemo(() => {
    if (!ui.ghost) return new Set<string>();
    const set = new Set<string>();
    for (const n of visibleNodes) if (checkPlacement(doc, n).some((i) => i.level === 'error')) set.add(n.id);
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, ui.ghost]);

  const single = sel.ids.length === 1 ? doc.nodes[sel.ids[0]] : null;
  const access = useEditor((s) => s.access);
  const handles = single && single.type !== 'group' && !single.locked && !walk && ui.tool !== 'rotate' && access !== 'VIEW' ? single : null;

  return (
    <>
      <color attach="background" args={[PRESETS[doc.lighting.preset].bg]} />
      <Lights doc={doc} ledPositions={ledPositions} />
      {doc.plan?.enabled && <PlanLights plan={doc.plan} />}
      <CameraRig doc={doc} walk={walk} />
      {walk && <WalkControls doc={doc} />}
      <group scale={M}>
        {doc.plan?.enabled ? <PlanMesh plan={doc.plan} showCeiling={ui.showCeiling} selection={sel.ids.concat(planSel)} showWalls={ui.showWalls} cutaway={!ui.walkthrough && ui.viewMode === 'room'} /> : <RoomMesh doc={doc} showWalls={ui.showWalls} cutaway={!ui.walkthrough && ui.viewMode === 'room'} showCeiling={ui.showCeiling} />}
        {visibleNodes.map((n) => (
          <group
            key={n.id}
            position={n.position}
            rotation={[0, (n.rotationY * Math.PI) / 180, 0]}
            onPointerDown={(e) => onNodeDown(e, n)}
            onDoubleClick={(e) => onNodeDouble(e, n)}
            onPointerOver={(e) => { e.stopPropagation(); useEditor.getState().setHovered(n.id); if (!walk) gl.domElement.style.cursor = n.locked ? 'not-allowed' : ui.tool === 'rotate' ? 'alias' : 'grab'; }}
            onPointerOut={() => { useEditor.getState().setHovered(null); gl.domElement.style.cursor = ''; }}
          >
            {n.type === 'model' && <ModelMesh node={n} />}
            <NodeParts node={n} ctx={ctx} selectedSub={selSet.has(n.id) && sel.ids.length === 1 ? sel.sub : null} exploded={explodedRef} forceIndividual={ui.exploded > 0.001 || (explodedRef.current > 0.002)} />
            {collisions.has(n.id) && <BoundsBox node={n} color="#ff3b30" opacity={0.9} />}
            {(selSet.has(n.id) || hovered === n.id) && <BoundsBox node={n} color={selSet.has(n.id) ? '#d9a93c' : '#8e8a80'} opacity={selSet.has(n.id) ? 1 : 0.6} />}
          </group>
        ))}
        {handles && <ResizeHandles node={handles} onStart={startResize} />}
      </group>
      {ui.showGrid && <GridPlane doc={doc} />}
      <ContactShadows key={bake.current} position={[0, 0.002, 0]} opacity={0.32} scale={30} blur={2.4} far={2.4} resolution={512} frames={2} />
      {ui.showDims && <DimLabels doc={doc} selected={[...selSet].filter((i) => doc.nodes[i]?.type !== 'group')} />}
      <PerfGuard count={visibleNodes.reduce((a, n) => a + buildParts(n).length, 0)} />
      <ResizeNotifier size={size} />
    </>
  );
}

function ResizeNotifier({ size }: { size: { width: number; height: number } }) {
  useEffect(() => {
    // invalidate on container resize is automatic in R3F; nothing else to do - hook kept for clarity
  }, [size.width, size.height]);
  return null;
}

function PerfGuard({ count }: { count: number }) {
  useEffect(() => {
    if (count > 9000) useEditor.getState().toast('warning', `This model has ${count.toLocaleString()} parts - the 3D view may be slow. Hide components you are not editing.`);
  }, [count]);
  return null;
}

function BoundsBox({ node, color, opacity }: { node: SceneNode; color: string; opacity: number }) {
  const b = nodeLocalBounds(node);
  const geo = useMemo(() => {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 6, h + 6, d + 6));
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    return g;
  }, [b]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineSegments geometry={geo} renderOrder={10} raycast={() => null} userData={{ uiOnly: true }}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
    </lineSegments>
  );
}

function ResizeHandles({ node, onStart }: { node: SceneNode; onStart: (e: ThreeEvent<PointerEvent>, n: SceneNode, axis: 'x+' | 'x-' | 'y+' | 'z+' | 'z-') => void }) {
  const { w, h, d } = node.size;
  const hs: { axis: 'x+' | 'x-' | 'y+' | 'z+' | 'z-'; p: Vec3 }[] = [
    { axis: 'x+', p: [w / 2, h / 2, 0] },
    { axis: 'x-', p: [-w / 2, h / 2, 0] },
    { axis: 'y+', p: [0, h, 0] },
    { axis: 'z+', p: [0, h / 2, d / 2] },
    { axis: 'z-', p: [0, h / 2, -d / 2] },
  ];
  return (
    <group position={node.position} rotation={[0, (node.rotationY * Math.PI) / 180, 0]} userData={{ uiOnly: true }}>
      {hs.map(({ axis, p }) => (
        <mesh key={axis} position={p} onPointerDown={(e) => onStart(e, node, axis)} renderOrder={20} onPointerOver={() => (document.body.style.cursor = 'ew-resize')} onPointerOut={() => (document.body.style.cursor = '')}>
          <sphereGeometry args={[30, 16, 12]} />
          <meshBasicMaterial color="#d9a93c" depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function GridPlane({ doc }: { doc: SceneDoc }) {
  const rb = roomBox(doc);
  const size = Math.max(rb.max[0] - rb.min[0], rb.max[2] - rb.min[2]) * M + 4;
  const cx = ((rb.min[0] + rb.max[0]) / 2) * M;
  const cz = ((rb.min[2] + rb.max[2]) / 2) * M;
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(size, Math.round(size / 0.5), 0xb9ae9d, 0xd8d0c3);
    (g.material as THREE.Material).transparent = true;
    (g.material as THREE.Material).opacity = 0.35;
    (g.material as THREE.Material).depthWrite = false;
    return g;
  }, [size]);
  useEffect(() => () => { grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); }, [grid]);
  return <primitive object={grid} position={[cx, 0.003, cz]} raycast={() => null} userData={{ uiOnly: true }} />;
}

function DimLabels({ doc, selected }: { doc: SceneDoc; selected: string[] }) {
  const labels: { p: Vec3; text: string; key: string }[] = [];
  if (selected.length) {
    for (const id of selected) {
      const n = doc.nodes[id];
      if (!n) continue;
      const b = nodeLocalBounds(n);
      const th = (n.rotationY * Math.PI) / 180;
      const w2 = (p: Vec3): Vec3 => [n.position[0] + p[0] * Math.cos(th) + p[2] * Math.sin(th), n.position[1] + p[1], n.position[2] - p[0] * Math.sin(th) + p[2] * Math.cos(th)];
      const midX = (b.min[0] + b.max[0]) / 2;
      const midY = (b.min[1] + b.max[1]) / 2;
      labels.push({ p: w2([midX, b.max[1] + 80, b.max[2]]), text: `W ${Math.round(b.max[0] - b.min[0])}`, key: id + 'w' });
      labels.push({ p: w2([b.max[0] + 60, midY, b.max[2]]), text: `H ${Math.round(b.max[1] - b.min[1])}`, key: id + 'h' });
      labels.push({ p: w2([b.max[0] + 60, b.min[1] + 40, (b.min[2] + b.max[2]) / 2]), text: `D ${Math.round(b.max[2] - b.min[2])}`, key: id + 'd' });
      if (n.position[1] > 1) labels.push({ p: w2([midX, b.min[1] - 80, b.max[2]]), text: `↑ ${Math.round(n.position[1])}`, key: id + 'e' });
    }
  } else {
    const rb = roomBox(doc);
    labels.push({ p: [(rb.min[0] + rb.max[0]) / 2, 40, rb.max[2] + 150], text: `${Math.round(rb.max[0] - rb.min[0])}`, key: 'rw' });
    labels.push({ p: [rb.max[0] + 150, 40, (rb.min[2] + rb.max[2]) / 2], text: `${Math.round(rb.max[2] - rb.min[2])}`, key: 'rd' });
  }
  return (
    <>
      {labels.map((l) => (
        <LabelSprite key={l.key} text={l.text} position={[l.p[0] * M, l.p[1] * M, l.p[2] * M]} />
      ))}
    </>
  );
}

/** Constant-screen-size text label (canvas texture on a sprite); avoids DOM portals inside the canvas. */
function LabelSprite({ text, position }: { text: string; position: [number, number, number] }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 72;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(38,39,43,0.92)';
    g.beginPath();
    g.roundRect(4, 4, 248, 64, 14);
    g.fill();
    g.fillStyle = '#f6e7bd';
    g.font = '600 38px Segoe UI, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 38);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={position} scale={[0.07, 0.0197, 1]} renderOrder={30} raycast={() => null} userData={{ uiOnly: true }}>
      <spriteMaterial map={tex} sizeAttenuation={false} depthTest={false} transparent toneMapped={false} />
    </sprite>
  );
}

export default function Viewport() {
  const camera = useEditor((s) => s.ui.camera);
  const sel = useEditor((s) => s.sel.ids.length);
  void sel;
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
      onPointerMissed={(e) => {
        if (e.button === 0 && !(e as MouseEvent).shiftKey) {
          const st = useEditor.getState();
          if (!st.tx) st.select([]);
        }
      }}
      style={{ touchAction: 'none' }}
    >
      {camera === 'perspective' ? <PerspectiveCamera makeDefault fov={35} near={0.05} far={120} position={[6, 5, 7]} /> : <OrthographicCamera makeDefault near={-50} far={120} position={[6, 5, 7]} zoom={120} />}
      <SceneContent />
    </Canvas>
  );
}
