'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { materialIndex } from '@/lib/catalog';
import { resolveMaterialId } from '@/lib/docs/resolve';
import { buildParts } from '@/lib/scene';
import { assetUrl, boxGeometry, cylinderGeometry, getThreeMaterial } from '@/lib/three/textures';
import type { MaterialDef, Part, SceneDoc, SceneNode } from '@/lib/types';
import { useEditor } from '@/store/editor';

const DEG = Math.PI / 180;
const HIGHLIGHT = new THREE.MeshBasicMaterial({ color: 0xe0b44c, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const GHOST = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.35, depthWrite: false });

function partGeometry(p: Part, tileMm: number): THREE.BufferGeometry {
  if (p.shape === 'cylinder') return cylinderGeometry(p.size[0], p.size[1]);
  return boxGeometry(p.size[0], p.size[1], p.size[2], tileMm, p.grain ?? 'length');
}

function baseMatrix(p: Part): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((p.rot?.[0] ?? 0) * DEG, (p.rot?.[1] ?? 0) * DEG, (p.rot?.[2] ?? 0) * DEG, 'XYZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(...p.center), q, new THREE.Vector3(1, 1, 1));
}

interface Ctx {
  doc: SceneDoc;
  matIdx: Map<string, MaterialDef>;
}

function subKey(p: Part) {
  return p.sub ? `${p.sub.kind}:${p.sub.index}` : '';
}

// ---------- individually transformed (animated / exploded) part ----------
function AnimPart({ node, part, mat, highlighted, exploded, tileMm, bounds }: { node: SceneNode; part: Part; mat: THREE.Material; highlighted: boolean; exploded: React.MutableRefObject<number>; tileMm: number; bounds: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const cur = useRef(0);
  const geo = useMemo(() => partGeometry(part, tileMm), [part, tileMm]);
  const base = useMemo(() => baseMatrix(part), [part]);
  const key = part.anim ? `${node.id}:${part.anim.group}` : '';
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), r: new THREE.Matrix4(), t1: new THREE.Matrix4(), t2: new THREE.Matrix4(), axis: new THREE.Vector3(), piv: new THREE.Vector3() }), []);
  const explodeDir = useMemo(() => {
    const c = new THREE.Vector3(...part.center);
    const d = c.clone().sub(new THREE.Vector3(0, bounds.y / 2, 0));
    // push fronts forward, sides apart, shelves vertically
    const k = part.role === 'door' || part.role === 'drawer_front' || part.role === 'hardware' ? new THREE.Vector3(0.2, 0.1, 1.6) : new THREE.Vector3(0.55, 0.5, 0.45);
    return d.multiply(k);
  }, [part, bounds]);
  const last = useRef({ open: -1, ex: -1 });

  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const target = key ? (useEditor.getState().openTargets[key] ?? 0) : 0;
    const prev = cur.current;
    cur.current += (target - cur.current) * Math.min(1, dt * 6);
    if (Math.abs(target - cur.current) < 0.001) cur.current = target;
    const ex = exploded.current;
    if (cur.current !== target) invalidate(); // still easing toward the target
    if (cur.current === last.current.open && ex === last.current.ex && prev === cur.current) return;
    last.current = { open: cur.current, ex };
    const t = cur.current;
    tmp.m.copy(base);
    const a = part.anim;
    if (a && t > 0) {
      if (a.kind === 'hinge' && a.pivot && a.axis) {
        tmp.axis.set(...a.axis).normalize();
        tmp.piv.set(...a.pivot);
        tmp.r.makeRotationAxis(tmp.axis, (a.angle ?? 90) * DEG * easeOut(t));
        tmp.t1.makeTranslation(tmp.piv.x, tmp.piv.y, tmp.piv.z);
        tmp.t2.makeTranslation(-tmp.piv.x, -tmp.piv.y, -tmp.piv.z);
        tmp.m.premultiply(tmp.t2).premultiply(tmp.r).premultiply(tmp.t1);
      } else if (a.kind === 'slide' && a.slide) {
        const d = (a.distance ?? 0) * easeOut(t);
        tmp.t1.makeTranslation(a.slide[0] * d, a.slide[1] * d, a.slide[2] * d);
        tmp.m.premultiply(tmp.t1);
      }
    }
    if (ex > 0.001) {
      tmp.t1.makeTranslation(explodeDir.x * ex, explodeDir.y * ex, explodeDir.z * ex);
      tmp.m.premultiply(tmp.t1);
    }
    m.matrix.copy(tmp.m);
    m.matrixWorldNeedsUpdate = true;
  });

  return (
    <mesh ref={ref} geometry={geo} material={mat} matrixAutoUpdate={false} castShadow receiveShadow userData={{ nodeId: node.id, sub: part.sub, group: part.anim?.group, role: part.role }}>
      {highlighted && <mesh geometry={geo} material={HIGHLIGHT} scale={1.003} />}
    </mesh>
  );
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.2);

// ---------- merged static batch ----------
function Batch({ node, parts, mat, highlighted, tileMm }: { node: SceneNode; parts: Part[]; mat: THREE.Material; highlighted: boolean; tileMm: number }) {
  const { geo, ranges } = useMemo(() => {
    const geos = parts.map((p) => {
      const g = partGeometry(p, tileMm).clone();
      g.applyMatrix4(baseMatrix(p));
      return g;
    });
    // triangle-index ranges let a click on the merged mesh be traced back to the part's sub-component
    let end = 0;
    const rs = geos.map((g, i) => {
      end += g.index ? g.index.count : g.getAttribute('position').count;
      return { end, sub: parts[i].sub };
    });
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) geos.forEach((g) => g.dispose());
    return { geo: merged ?? geos[0], ranges: rs };
  }, [parts, tileMm]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} material={mat} castShadow receiveShadow userData={{ nodeId: node.id, ranges }}>
      {highlighted && <mesh geometry={geo} material={HIGHLIGHT} scale={1.003} />}
    </mesh>
  );
}

export const NodeParts = memo(function NodeParts({ node, ctx, selectedSub, exploded, forceIndividual }: { node: SceneNode; ctx: Ctx; selectedSub: { kind: string; index: number } | null; exploded: React.MutableRefObject<number>; forceIndividual: boolean }) {
  const parts = useMemo(() => buildParts(node), [node]);
  const bounds = useMemo(() => new THREE.Vector3(node.size.w, node.size.h, node.size.d), [node.size.w, node.size.h, node.size.d]);
  const { doc } = ctx;
  const resolved = useMemo(
    () =>
      parts.map((p) => {
        const id = resolveMaterialId(doc, node, p);
        const def = ctx.matIdx.get(id) ?? ctx.matIdx.get('lam-white-matte')!;
        return { p, def, mat: getThreeMaterial(p.light ? { ...def, emissive: p.light.color } : def), tile: 1000 / (def.textureScale || 1) };
      }),
    [parts, doc, node, ctx.matIdx],
  );

  const isHi = (p: Part) => !!selectedSub && !!p.sub && p.sub.kind === selectedSub.kind && p.sub.index === selectedSub.index;

  const individually = forceIndividual ? resolved : resolved.filter((r) => r.p.anim);
  const batches = useMemo(() => {
    if (forceIndividual) return [] as { key: string; parts: Part[]; mat: THREE.Material; tile: number; hi: boolean }[];
    const map = new Map<string, { key: string; parts: Part[]; mat: THREE.Material; tile: number; hi: boolean }>();
    for (const r of resolved) {
      if (r.p.anim) continue;
      const hi = isHi(r.p);
      // highlighted sub-components get their own batch so only they glow
      const key = `${r.def.id}|${r.tile}|${r.p.grain}|${hi ? subKey(r.p) : ''}`;
      const b = map.get(key);
      if (b) b.parts.push(r.p);
      else map.set(key, { key, parts: [r.p], mat: r.mat, tile: r.tile, hi });
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, forceIndividual, selectedSub?.kind, selectedSub?.index]);

  return (
    <>
      {batches.map((b) => (
        <Batch key={b.key} node={node} parts={b.parts} mat={b.mat} highlighted={b.hi} tileMm={b.tile} />
      ))}
      {individually.map((r) => (
        <AnimPart key={r.p.id} node={node} part={r.p} mat={r.mat} highlighted={isHi(r.p)} exploded={exploded} tileMm={r.tile} bounds={bounds} />
      ))}
    </>
  );
});

export { GHOST };
export function materialMap(doc: SceneDoc) {
  return materialIndex(doc.customMaterials);
}

/** Renders an imported GLB scaled to the node's width/height/depth (bottom-centre at the origin). */
export function ModelMesh({ node }: { node: SceneNode }) {
  const url = (node.params as { url?: string }).url;
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    new GLTFLoader().load(
      assetUrl(url),
      (g) => {
        if (cancelled) return;
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            m.userData.nodeId = node.id;
          }
        });
        setObj(g.scene);
      },
      undefined,
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  const fitted = useMemo(() => {
    if (!obj) return null;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const sx = node.size.w / Math.max(size.x, 1e-6);
    const sy = node.size.h / Math.max(size.y, 1e-6);
    const sz = node.size.d / Math.max(size.z, 1e-6);
    const c = box.getCenter(new THREE.Vector3());
    return { scale: [sx, sy, sz] as [number, number, number], offset: [-c.x * sx, -box.min.y * sy, -c.z * sz] as [number, number, number] };
  }, [obj, node.size.w, node.size.h, node.size.d]);
  if (failed || !url || !fitted || !obj)
    return (
      <mesh position={[0, node.size.h / 2, 0]} userData={{ nodeId: node.id }}>
        <boxGeometry args={[node.size.w, node.size.h, node.size.d]} />
        <meshStandardMaterial color={failed ? '#b4423a' : '#c9c2b4'} transparent opacity={0.5} wireframe={!failed} />
      </mesh>
    );
  return <primitive object={obj} scale={fitted.scale} position={fitted.offset} />;
}
