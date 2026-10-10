'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { materialIndex, SLOT_FALLBACK } from '@/lib/catalog';
import { wallEdges } from '@/lib/scene';
import { getThreeMaterial } from '@/lib/three/textures';
import type { MaterialDef, SceneDoc } from '@/lib/types';

function matFor(doc: SceneDoc, id: string): MaterialDef {
  const idx = materialIndex(doc.customMaterials);
  return idx.get(id) ?? idx.get(SLOT_FALLBACK.carcass)!;
}

/** Scale UVs so that 1 uv unit == one texture tile (tile size in mm). */
function tileUVs(g: THREE.BufferGeometry, tileMm: number, plane: 'xy' | 'xz') {
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tileMm, (plane === 'xy' ? pos.getY(i) : pos.getZ(i)) / tileMm);
  uv.needsUpdate = true;
}

export function RoomMesh({ doc, showWalls, cutaway, showCeiling }: { doc: SceneDoc; showWalls: boolean; cutaway: boolean; showCeiling: boolean }) {
  const { room } = doc;
  const floorMat = useMemo(() => getThreeMaterial({ ...matFor(doc, room.floorMaterial) }), [doc, room.floorMaterial]);
  const wallMat = useMemo(() => getThreeMaterial(matFor(doc, room.wallMaterial)), [doc, room.wallMaterial]);
  const ceilMat = useMemo(() => getThreeMaterial(matFor(doc, room.ceilingMaterial)), [doc, room.ceilingMaterial]);
  const floorDef = matFor(doc, room.floorMaterial);

  const floorGeo = useMemo(() => {
    const shape = new THREE.Shape(room.points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape);
    tileUVs(g, 1000 / (floorDef.textureScale || 1), 'xy');
    return g;
  }, [room.points, floorDef.textureScale]);

  const ceilGeo = useMemo(() => {
    const shape = new THREE.Shape(room.points.map(([x, z]) => new THREE.Vector2(x, -z)));
    return new THREE.ShapeGeometry(shape);
  }, [room.points]);

  const edges = useMemo(() => wallEdges(room), [room]);

  const walls = useMemo(
    () =>
      edges.map((e) => {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(e.length, 0);
        shape.lineTo(e.length, room.height);
        shape.lineTo(0, room.height);
        shape.lineTo(0, 0);
        for (const o of room.openings) {
          if (o.wall !== e.index) continue;
          const hole = new THREE.Path();
          const x0 = Math.max(1, o.offset);
          const x1 = Math.min(e.length - 1, o.offset + o.width);
          const y0 = Math.max(0, o.sill);
          const y1 = Math.min(room.height - 1, o.sill + o.height);
          hole.moveTo(x0, Math.max(y0, 1));
          hole.lineTo(x1, Math.max(y0, 1));
          hole.lineTo(x1, y1);
          hole.lineTo(x0, y1);
          hole.lineTo(x0, Math.max(y0, 1));
          shape.holes.push(hole);
        }
        const g = new THREE.ExtrudeGeometry(shape, { depth: room.wallThickness, bevelEnabled: false });
        g.translate(0, 0, -room.wallThickness);
        tileUVs(g, 1000, 'xy');
        const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(e.dir[0], 0, e.dir[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-e.dir[1], 0, e.dir[0]));
        basis.setPosition(e.p0[0], 0, e.p0[1]);
        return { geo: g, matrix: basis, edge: e, mid: new THREE.Vector3((e.p0[0] + e.p1[0]) / 2, room.height / 2, (e.p0[1] + e.p1[1]) / 2), out: new THREE.Vector3(-e.normal[0], 0, -e.normal[1]) };
      }),
    [edges, room],
  );

  useEffect(() => () => { walls.forEach((w) => w.geo.dispose()); floorGeo.dispose(); ceilGeo.dispose(); }, [walls, floorGeo, ceilGeo]);

  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const openRefs = useRef<Record<string, THREE.Group | null>>({});
  const { camera } = useThree();
  const cam = new THREE.Vector3();
  useFrame(() => {
    cam.copy(camera.position).multiplyScalar(1000);
    walls.forEach((w, i) => {
      const m = refs.current[i];
      if (!m) return;
      if (!showWalls) {
        m.visible = false;
        return;
      }
      // cutaway: hide a wall when the camera is on its outer side
      const toCam = cam.clone().sub(w.mid);
      m.visible = !(cutaway && toCam.dot(w.out) > 0);
    });
    // door/window fittings follow their wall's visibility
    for (const o of room.openings) {
      const g = openRefs.current[o.id];
      const wi = walls.findIndex((w) => w.edge.index === o.wall);
      if (g && wi >= 0) g.visible = !!refs.current[wi]?.visible;
    }
  });

  const openingsMeshes = room.openings.map((o) => {
    const e = edges[o.wall];
    if (!e) return null;
    const cx = e.p0[0] + e.dir[0] * (o.offset + o.width / 2);
    const cz = e.p0[1] + e.dir[1] * (o.offset + o.width / 2);
    const rot = Math.atan2(-e.dir[1], e.dir[0]); // local x along the wall
    return { o, cx, cz, rot, e };
  });

  return (
    <group>
      <mesh geometry={floorGeo} material={floorMat} rotation={[-Math.PI / 2, 0, 0]} receiveShadow />
      {showCeiling && <mesh geometry={ceilGeo} material={ceilMat} rotation={[Math.PI / 2, 0, 0]} position={[0, room.height, 0]} />}
      {walls.map((w, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} geometry={w.geo} material={wallMat} matrixAutoUpdate={false} matrix={w.matrix} receiveShadow castShadow />
      ))}
      {showWalls &&
        openingsMeshes.map((m) => {
          if (!m) return null;
          const { o, cx, cz, rot, e } = m;
          const pos: [number, number, number] = [cx - e.normal[0] * room.wallThickness / 2, o.sill + o.height / 2, cz - e.normal[1] * room.wallThickness / 2];
          return (
            <group key={o.id} ref={(el) => { openRefs.current[o.id] = el; }} position={pos} rotation={[0, rot, 0]}>
              {o.kind === 'window' && (
                <>
                  <mesh>
                    <boxGeometry args={[o.width - 40, o.height - 40, 6]} />
                    <meshPhysicalMaterial color="#cfe6ee" transparent opacity={0.22} roughness={0.03} envMapIntensity={1.4} depthWrite={false} />
                  </mesh>
                  {[
                    [0, o.height / 2 - 20, o.width, 40],
                    [0, -o.height / 2 + 20, o.width, 40],
                    [-o.width / 2 + 20, 0, 40, o.height],
                    [o.width / 2 - 20, 0, 40, o.height],
                    [0, 0, 24, o.height],
                  ].map(([x, y, w, h], i) => (
                    <mesh key={i} position={[x, y, 0]}>
                      <boxGeometry args={[w, h, 50]} />
                      <meshStandardMaterial color="#f4f1ec" roughness={0.6} />
                    </mesh>
                  ))}
                </>
              )}
              {o.kind === 'door' && (
                <mesh>
                  <boxGeometry args={[o.width - 30, o.height - 20, 40]} />
                  <meshStandardMaterial color="#c9a37a" roughness={0.55} />
                </mesh>
              )}
            </group>
          );
        })}
      {room.columns.map((c) => (
        <mesh key={c.id} position={[c.x, room.height / 2, c.z]} material={wallMat} castShadow receiveShadow>
          <boxGeometry args={[c.w, room.height, c.d]} />
        </mesh>
      ))}
    </group>
  );
}
