'use client';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { floor3D, type Plan3D, type SurfaceSolid, type TileSpec, type WallSolid } from '@/lib/plan/model3d';
import { roomsOf } from '@/lib/plan/rooms';
import type { Floor, PlanModel, Pt } from '@/lib/plan/types';
import { assetUrl } from '@/lib/three/textures';
import { useEditor } from '@/store/editor';
import { planHost } from '@/store/planHost';
import { usePlanUi } from '@/store/planUi';

const M = 0.001;
const SELECT = '#d9a93c';

// ---------- materials ----------
const matCache = new Map<string, THREE.Material>();
function mat(color: string, o: { rough?: number; opacity?: number; selected?: boolean; xray?: boolean; metal?: number; side?: THREE.Side } = {}): THREE.Material {
  const op = o.xray ? Math.min(o.opacity ?? 1, 0.22) : o.opacity ?? 1;
  const key = `${color}|${o.rough}|${op}|${o.selected}|${o.metal}|${o.side}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: o.selected ? SELECT : color,
      roughness: o.rough ?? 0.85,
      metalness: o.metal ?? 0,
      transparent: op < 1,
      opacity: op,
      depthWrite: op >= 1,
      side: o.side ?? THREE.FrontSide,
      emissive: o.selected ? SELECT : '#000000',
      emissiveIntensity: o.selected ? 0.25 : 0,
    });
    matCache.set(key, m);
  }
  return m;
}

/** Drops generated materials and tile textures (they are rebuilt on demand). */
export function clearPlanCaches(): { materials: number; textures: number } {
  const out = { materials: matCache.size, textures: texCache.size };
  matCache.forEach((x) => x.dispose());
  matCache.clear();
  texCache.forEach((x) => x.dispose());
  texCache.clear();
  window.dispatchEvent(new Event('nivas-invalidate'));
  return out;
}

// ---------- tile textures ----------
const texCache = new Map<string, THREE.CanvasTexture>();
/** One texture repeat = one "cell" (a tile plus its grout; brick pattern uses two courses). Returns the cell size in mm. */
function tileTexture(t: TileSpec): { tex: THREE.CanvasTexture; cell: [number, number] } {
  const key = `${t.w}|${t.h}|${t.grout}|${t.pattern}|${t.color}`;
  const cw = t.w + t.grout;
  const ch = t.h + t.grout;
  const rows = t.pattern === 'brick' ? 2 : 1;
  let tex = texCache.get(key);
  if (!tex) {
    const px = 256;
    const c = document.createElement('canvas');
    c.width = px;
    c.height = Math.max(32, Math.round(px * ((ch * rows) / cw)));
    c.height = Math.min(1024, c.height);
    const g = c.getContext('2d')!;
    g.fillStyle = '#9a968e'; // grout
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = t.color;
    const sx = c.width / cw;
    const sy = c.height / (ch * rows);
    const gx = (t.grout / 2) * sx;
    const gy = (t.grout / 2) * sy;
    for (let r = 0; r < rows; r++) {
      const off = t.pattern === 'brick' && r === 1 ? c.width / 2 : 0;
      for (const o of [off, off - c.width]) g.fillRect(o + gx, r * ch * sy + gy, t.w * sx, t.h * sy);
      if (off) g.fillRect(off + c.width + gx, r * ch * sy + gy, t.w * sx, t.h * sy);
    }
    tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    texCache.set(key, tex);
  }
  return { tex, cell: [cw, ch * rows] };
}

function tileMaterial(t: TileSpec, xray: boolean): THREE.Material {
  const { tex } = tileTexture(t);
  const key = `tile|${tex.uuid}|${xray}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05, transparent: xray, opacity: xray ? 0.3 : 1, side: THREE.DoubleSide });
    matCache.set(key, m);
  }
  return m;
}

// ---------- geometry builders ----------
function shapeOf(poly: Pt[]): THREE.Shape {
  return new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
}

/** Prism standing on y = base, extruded up by `depth` (mm). Shape lives in plan coordinates. */
function prism(poly: Pt[], depth: number, tile?: TileSpec): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapeOf(poly), { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // (x, y, z) -> (x, z, -y): plan point (x, y) lands on world (x, ·, y)
  if (tile) {
    const { cell } = tileTexture(tile);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const rot = (tile.rotation + (tile.pattern === 'diagonal' ? 45 : 0)) * (Math.PI / 180);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i < uv.count; i++) {
      if (nor.getY(i) < 0.5) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uv.setXY(i, (x * c + z * s) / cell[0], (-x * s + z * c) / cell[1]);
    }
    uv.needsUpdate = true;
  }
  return g;
}

function wallGeometry(w: WallSolid): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(w.start, 0);
  shape.lineTo(w.end, 0);
  shape.lineTo(w.end, w.height);
  shape.lineTo(w.start, w.height);
  shape.lineTo(w.start, 0);
  for (const h of w.holes) {
    const x0 = Math.max(w.start + 1, h.x0);
    const x1 = Math.min(w.end - 1, h.x1);
    const y0 = Math.max(1, h.y0);
    const y1 = Math.min(w.height - 1, h.y1);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const p = new THREE.Path();
    p.moveTo(x0, y0);
    p.lineTo(x1, y0);
    p.lineTo(x1, y1);
    p.lineTo(x0, y1);
    p.lineTo(x0, y0);
    shape.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: w.thickness, bevelEnabled: false });
  g.translate(0, 0, -w.thickness / 2);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 1000, pos.getY(i) / 1000);
  return g;
}

/** matrix that maps a wall's local frame (x along the wall, y up, z across) into plan/world mm */
function wallMatrix(w: { a: Pt; dir: Pt }, y0: number): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(w.dir[0], 0, w.dir[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-w.dir[1], 0, w.dir[0]));
  m.setPosition(w.a[0], y0, w.a[1]);
  return m;
}

// ---------- pieces ----------
function Wall({ w, selected, xray, onPick, out, show, cutaway }: { w: WallSolid; selected: boolean; xray: boolean; onPick: (id: string) => void; out: Pt | null; show: boolean; cutaway: boolean }) {
  const geo = useMemo(() => wallGeometry(w), [w]);
  useEffect(() => () => geo.dispose(), [geo]);
  const matrix = useMemo(() => wallMatrix(w, w.y0), [w]);
  const ref = useRef<THREE.Group>(null);
  const mid = useMemo<Pt>(() => [w.a[0] + (w.dir[0] * (w.start + w.end)) / 2, w.a[1] + (w.dir[1] * (w.start + w.end)) / 2], [w]);
  // cut-away: an outer wall whose outside faces the camera is hidden so the interior can be seen
  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g) return;
    let vis = show;
    if (vis && cutaway && out) vis = (camera.position.x * 1000 - mid[0]) * out[0] + (camera.position.z * 1000 - mid[1]) * out[1] <= 0;
    if (g.visible !== vis) g.visible = vis;
  });
  return (
    <group ref={ref} matrixAutoUpdate={false} matrix={matrix}>
      <mesh geometry={geo} material={mat(w.color, { selected, xray, opacity: 1 })} castShadow receiveShadow onClick={(e) => { if (e.delta < 4) { e.stopPropagation(); onPick(w.id); } }} />
      {w.holes.map((h, i) => {
        const wd = h.x1 - h.x0;
        const ht = Math.min(w.height, h.y1) - Math.max(0, h.y0);
        const cx = (h.x0 + h.x1) / 2;
        const cy = (Math.max(0, h.y0) + Math.min(w.height, h.y1)) / 2;
        return h.kind === 'window' ? (
          <group key={i} position={[cx, cy, 0]}>
            <mesh material={mat('#cfe6ee', { opacity: 0.25, rough: 0.05, xray })}>
              <boxGeometry args={[wd - 40, ht - 40, 6]} />
            </mesh>
            {[
              [0, ht / 2 - 20, wd, 40],
              [0, -ht / 2 + 20, wd, 40],
              [-wd / 2 + 20, 0, 40, ht],
              [wd / 2 - 20, 0, 40, ht],
              [0, 0, 24, ht],
            ].map(([x, y, bw, bh], k) => (
              <mesh key={k} position={[x, y, 0]} material={mat('#f4f1ec', { rough: 0.6, xray })}>
                <boxGeometry args={[bw, bh, Math.min(w.thickness + 20, 120)]} />
              </mesh>
            ))}
          </group>
        ) : (
          <group key={i} position={[cx, cy, 0]}>
            <mesh material={mat('#c9a37a', { rough: 0.55, xray })} position={[0, 0, 0]}>
              <boxGeometry args={[wd - 30, ht - 15, 40]} />
            </mesh>
            <mesh material={mat('#6b5a45', { rough: 0.4, metal: 0.6, xray })} position={[wd / 2 - 90, -ht * 0.05, 30]}>
              <boxGeometry args={[110, 20, 20]} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} material={mat('#e7e0d3', { xray })} position={[s * (wd / 2 - 8), 0, 0]}>
                <boxGeometry args={[16, ht, Math.min(w.thickness + 20, 120)]} />
              </mesh>
            ))}
            <mesh material={mat('#e7e0d3', { xray })} position={[0, ht / 2 - 8, 0]}>
              <boxGeometry args={[wd, 16, Math.min(w.thickness + 20, 120)]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Surface({ s, selected, xray, onPick }: { s: SurfaceSolid; selected: boolean; xray: boolean; onPick: (id: string) => void }) {
  const geo = useMemo(() => prism(s.poly, s.thickness, s.tile), [s]);
  useEffect(() => () => geo.dispose(), [geo]);
  const base = s.kind === 'slab' ? s.y - s.thickness : s.kind === 'floor-finish' ? s.y - s.thickness : s.y;
  const material = s.tile && !selected ? tileMaterial(s.tile, xray) : mat(s.color, { selected, xray, rough: s.kind === 'floor-finish' ? 0.5 : 0.9 });
  return (
    <mesh
      geometry={geo}
      material={material}
      position={[0, base, 0]}
      receiveShadow
      castShadow={s.kind !== 'floor-finish'}
      onClick={s.kind === 'floor-finish' ? undefined : (e) => { if (e.delta < 4) { e.stopPropagation(); onPick(s.id); } }}
    />
  );
}

function WallTile({ t, xray }: { t: Plan3D['wallTiles'][number]; xray: boolean }) {
  const L = Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]);
  const { cell } = tileTexture(t.tile);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(L, t.height);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * L) / cell[0], (uv.getY(i) * t.height) / cell[1]);
    return g;
  }, [L, t.height, cell]);
  useEffect(() => () => geo.dispose(), [geo]);
  const dx = (t.b[0] - t.a[0]) / (L || 1);
  const dz = (t.b[1] - t.a[1]) / (L || 1);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(dx, 0, dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-dz, 0, dx));
  m.setPosition((t.a[0] + t.b[0]) / 2, t.y0 + t.height / 2, (t.a[1] + t.b[1]) / 2);
  return <mesh geometry={geo} material={tileMaterial(t.tile, xray)} matrixAutoUpdate={false} matrix={m} />;
}

function Column({ c, selected, xray, onPick }: { c: Plan3D['columns'][number]; selected: boolean; xray: boolean; onPick: (id: string) => void }) {
  const geo = useMemo(() => prism(c.poly, c.height), [c]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={mat('#d6d0c4', { selected, xray })} position={[0, c.y0, 0]} castShadow receiveShadow onClick={(e) => { if (e.delta < 4) { e.stopPropagation(); onPick(c.id); } }} />;
}

function Beam({ b, selected, xray, onPick }: { b: Plan3D['beams'][number]; selected: boolean; xray: boolean; onPick: (id: string) => void }) {
  const L = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]);
  const ang = Math.atan2(b.b[1] - b.a[1], b.b[0] - b.a[0]);
  return (
    <mesh material={mat('#cfc8bb', { selected, xray })} position={[(b.a[0] + b.b[0]) / 2, b.y + b.depth / 2, (b.a[1] + b.b[1]) / 2]} rotation={[0, -ang, 0]} castShadow receiveShadow onClick={(e) => { if (e.delta < 4) { e.stopPropagation(); onPick(b.id); } }}>
      <boxGeometry args={[L, b.depth, b.width]} />
    </mesh>
  );
}

function Stairs({ s, base, selected, xray, onPick }: { s: Plan3D['stairs'][number]; base: number; selected: boolean; xray: boolean; onPick: (id: string) => void }) {
  const geos = useMemo(() => s.steps.map((st) => prism(st.poly, Math.max(1, st.top - base))), [s, base]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return (
    <group onClick={(e) => { if (e.delta < 4) { e.stopPropagation(); onPick(s.id); } }}>
      {geos.map((g, i) => <mesh key={i} geometry={g} material={mat(i % 2 ? '#c8bfae' : '#d3cbbb', { selected, xray })} position={[0, base, 0]} castShadow receiveShadow />)}
    </group>
  );
}

function Railing({ r, selected, xray, onPick }: { r: Plan3D['railings'][number]; selected: boolean; xray: boolean; onPick: (id: string) => void }) {
  return (
    <group onClick={(e) => { if (e.delta < 4) { e.stopPropagation(); onPick(r.id); } }}>
      {r.posts.map((p, i) => (
        <mesh key={i} material={mat('#5d5a54', { selected, xray, metal: 0.6, rough: 0.4 })} position={[p[0], r.y0 + r.height / 2, p[1]]} castShadow>
          <boxGeometry args={[24, r.height, 24]} />
        </mesh>
      ))}
      {r.rail.slice(0, -1).map((a, i) => {
        const b = r.rail[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        return (
          <mesh key={`r${i}`} material={mat('#3c3a36', { selected, xray, metal: 0.6, rough: 0.35 })} position={[(a[0] + b[0]) / 2, r.y0 + r.height - 20, (a[1] + b[1]) / 2]} rotation={[0, -ang, 0]} castShadow>
            <boxGeometry args={[L + 24, 40, 50]} />
          </mesh>
        );
      })}
    </group>
  );
}

function Roof({ r, selected, xray, onPick }: { r: Plan3D['roofs'][number]; selected: boolean; xray: boolean; onPick: (id: string) => void }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const v: number[] = [];
    for (const t of r.tris) for (const p of t) v.push(p[0], p[1], p[2]);
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }, [r]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={mat('#a8624a', { selected, xray, rough: 0.8, side: THREE.DoubleSide })} castShadow receiveShadow onClick={(e) => { if (e.delta < 4) { e.stopPropagation(); onPick(r.id); } }} />;
}

function ImportedModel({ m, selected, xray, onPick }: { m: Plan3D['models'][number]; selected: boolean; xray: boolean; onPick: (id: string) => void }) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false;
    new GLTFLoader().load(
      assetUrl(m.url),
      (g) => {
        if (off) return;
        g.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        setObj(g.scene);
        window.dispatchEvent(new Event('nivas-invalidate'));
      },
      undefined,
      () => !off && setFailed(true),
    );
    return () => {
      off = true;
    };
  }, [m.url]);
  const fit = useMemo(() => {
    if (!obj) return null;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const sx = m.size.w / Math.max(size.x, 1e-6);
    const sy = m.size.h / Math.max(size.y, 1e-6);
    const sz = m.size.d / Math.max(size.z, 1e-6);
    return { s: [sx, sy, sz] as [number, number, number], o: [-c.x * sx, -box.min.y * sy, -c.z * sz] as [number, number, number] };
  }, [obj, m.size.w, m.size.h, m.size.d]);
  return (
    <group position={m.pos} rotation={[0, (-m.rot * Math.PI) / 180, 0]} onClick={(e) => { if (e.delta < 4) { e.stopPropagation(); onPick(m.id); } }}>
      {obj && fit && !failed ? (
        <primitive object={obj} scale={fit.s} position={fit.o} />
      ) : (
        <mesh position={[0, m.size.h / 2, 0]} material={mat(failed ? '#b4423a' : selected ? SELECT : '#c9c2b4', { opacity: 0.55, xray })}>
          <boxGeometry args={[m.size.w, m.size.h, m.size.d]} />
        </mesh>
      )}
    </group>
  );
}

/** For walls on the outside of the building: the unit normal pointing away from the rooms. Interior walls get none. */
function outwardNormals(floor: Floor, plan: PlanModel, walls: WallSolid[]): Map<string, Pt> {
  const rooms = roomsOf(floor, plan.roomProps);
  const inside = (p: Pt) => rooms.some((r) => pointInPoly(p, r.outline));
  const out = new Map<string, Pt>();
  for (const w of walls) {
    const n: Pt = [-w.dir[1], w.dir[0]];
    const mid: Pt = [w.a[0] + (w.dir[0] * (w.start + w.end)) / 2, w.a[1] + (w.dir[1] * (w.start + w.end)) / 2];
    const d = w.thickness / 2 + 120;
    const front = inside([mid[0] + n[0] * d, mid[1] + n[1] * d]);
    const back = inside([mid[0] - n[0] * d, mid[1] - n[1] * d]);
    if (front && !back) out.set(w.id, [-n[0], -n[1]]);
    else if (back && !front) out.set(w.id, n);
  }
  return out;
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i][1] > p[1] !== poly[j][1] > p[1] && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
  }
  return inside;
}

function floorsToShow(plan: PlanModel, mode: 'all' | 'upTo' | 'active'): Floor[] {
  const b = plan.buildings.find((x) => x.id === plan.activeBuildingId) ?? plan.buildings[0];
  const active = b.floors.find((f) => f.id === plan.activeFloorId) ?? b.floors[0];
  const sorted = [...b.floors].sort((a, c) => a.elevation - c.elevation);
  if (mode === 'all') return sorted;
  if (mode === 'active') return [active];
  return sorted.filter((f) => f.elevation <= active.elevation);
}

/** True when a scene node (furniture / cabinet) belongs to a floor that is currently shown. */
export function nodeShownInPlan(plan: PlanModel, floorId: string | undefined, mode: 'all' | 'upTo' | 'active'): boolean {
  const first = plan.buildings[0]?.floors[0]?.id;
  const id = floorId ?? first;
  return floorsToShow(plan, mode).some((f) => f.id === id);
}

/** Everything the plan model contributes to the 3D scene. Rendered inside the mm-scaled group. */
export function PlanMesh({ plan, showCeiling, selection, showWalls = true, cutaway = false }: { plan: PlanModel; showCeiling: boolean; selection: string[]; showWalls?: boolean; cutaway?: boolean }) {
  const xray = plan.settings.xray;
  const mode = usePlanUi((s) => s.floorMode);
  const selected = useMemo(() => new Set(selection), [selection]);
  const floors = floorsToShow(plan, mode);
  const onPick = (id: string) => planHost.setSelection([id]);
  return (
    <group>
      {floors.map((f) => (
        <FloorMesh key={f.id} floor={f} plan={plan} showCeiling={showCeiling} selected={selected} xray={xray} onPick={onPick} showWalls={showWalls} cutaway={cutaway} />
      ))}
    </group>
  );
}

function FloorMesh({ floor, plan, showCeiling, selected, xray, onPick, showWalls, cutaway }: { floor: Floor; plan: PlanModel; showCeiling: boolean; selected: Set<string>; xray: boolean; onPick: (id: string) => void; showWalls: boolean; cutaway: boolean }) {
  const d = useMemo(() => floor3D(floor, plan.roomProps), [floor, plan.roomProps]);
  const outs = useMemo(() => outwardNormals(floor, plan, d.walls), [floor, plan, d.walls]);
  const sel = (id: string) => selected.has(id);
  return (
    <group>
      {d.walls.map((w) => <Wall key={w.id} w={w} selected={sel(w.id)} xray={xray} onPick={onPick} out={outs.get(w.id) ?? null} show={showWalls} cutaway={cutaway} />)}
      {d.surfaces.filter((s) => s.visible && (s.kind !== 'ceiling' || showCeiling)).map((s) => <Surface key={s.id} s={s} selected={sel(s.id)} xray={xray} onPick={onPick} />)}
      {d.wallTiles.map((t) => <WallTile key={t.id} t={t} xray={xray} />)}
      {d.columns.map((c) => <Column key={c.id} c={c} selected={sel(c.id)} xray={xray} onPick={onPick} />)}
      {d.beams.map((b) => <Beam key={b.id} b={b} selected={sel(b.id)} xray={xray} onPick={onPick} />)}
      {d.stairs.map((s) => <Stairs key={s.id} s={s} base={d.elevation} selected={sel(s.id)} xray={xray} onPick={onPick} />)}
      {d.railings.map((r) => <Railing key={r.id} r={r} selected={sel(r.id)} xray={xray} onPick={onPick} />)}
      {d.roofs.map((r) => <Roof key={r.id} r={r} selected={sel(r.id)} xray={xray} onPick={onPick} />)}
      {d.models.map((m) => <ImportedModel key={m.id} m={m} selected={sel(m.id)} xray={xray} onPick={onPick} />)}
      {d.lights.map((l) => (
        <mesh key={l.id} position={l.p} material={mat(l.color, { selected: sel(l.id), rough: 0.3 })}>
          <sphereGeometry args={[l.lightType === 'ceiling' ? 70 : 45, 16, 12]} />
        </mesh>
      ))}
      {d.strips.map((s) => {
        const L = Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]);
        const ang = Math.atan2(s.b[2] - s.a[2], s.b[0] - s.a[0]);
        return (
          <mesh key={s.id} position={[(s.a[0] + s.b[0]) / 2, s.a[1], (s.a[2] + s.b[2]) / 2]} rotation={[0, -ang, 0]}>
            <boxGeometry args={[L, 14, 22]} />
            <meshBasicMaterial color={sel(s.id) ? SELECT : s.color} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Real scene lights created by the plan's light / strip-light objects (a few, to keep the GPU happy). Rendered in metres. */
export function PlanLights({ plan }: { plan: PlanModel }) {
  const existing = plan.settings.showLights;
  const mode = usePlanUi((s) => s.floorMode);
  const lights = useMemo(() => {
    const out: { p: [number, number, number]; color: string; i: number; spot: boolean }[] = [];
    for (const f of floorsToShow(plan, mode)) {
      const d = floor3D(f, plan.roomProps);
      for (const l of d.lights) out.push({ p: [l.p[0] * M, l.p[1] * M, l.p[2] * M], color: l.color, i: l.intensity, spot: l.lightType === 'spot' });
      for (const s of d.strips) out.push({ p: [((s.a[0] + s.b[0]) / 2) * M, s.a[1] * M, ((s.a[2] + s.b[2]) / 2) * M], color: s.color, i: s.intensity * 0.6, spot: false });
    }
    return out.slice(0, 12);
  }, [plan, mode]);
  const extra = plan.extraLighting ?? 1;
  if (!existing) return null;
  return (
    <group>
      {lights.map((l, i) => <pointLight key={i} position={l.p} color={l.color} intensity={1.6 * l.i * extra} distance={6} decay={2} />)}
    </group>
  );
}

export function usePlanActive(): PlanModel | null {
  const doc = useEditor((s) => s.doc);
  return doc.plan?.enabled ? doc.plan : null;
}
