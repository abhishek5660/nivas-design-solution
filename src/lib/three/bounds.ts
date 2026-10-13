import { entityBounds } from '../plan/entities';
import { planHasContent } from '../plan/model3d';
import { buildParts } from '../scene';
import type { Part, SceneDoc, SceneNode, Vec3 } from '../types';

export interface Box3m {
  min: Vec3;
  max: Vec3;
}

function partExtent(p: Part): Vec3 {
  let [sx, sy, sz] = p.size;
  if (p.shape === 'cylinder') {
    const r = p.rot ?? [0, 0, 0];
    if (Math.abs(r[2]) === 90) [sx, sy, sz] = [p.size[1], p.size[0], p.size[2]];
    else if (Math.abs(r[0]) === 90) [sx, sy, sz] = [p.size[0], p.size[2], p.size[1]];
  }
  return [sx, sy, sz];
}

const cache = new WeakMap<SceneNode, Box3m>();

/** Local-space (node origin) bounds of everything the node draws. */
export function nodeLocalBounds(node: SceneNode): Box3m {
  const hit = cache.get(node);
  if (hit) return hit;
  const parts = buildParts(node);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    if (p.anim || p.role === 'led') continue; // closed-state envelope only
    const e = partExtent(p);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p.center[i] - e[i] / 2);
      max[i] = Math.max(max[i], p.center[i] + e[i] / 2);
    }
  }
  if (!Number.isFinite(min[0])) {
    min[0] = -node.size.w / 2;
    max[0] = node.size.w / 2;
    min[1] = 0;
    max[1] = node.size.h;
    min[2] = -node.size.d / 2;
    max[2] = node.size.d / 2;
  }
  const b = { min, max };
  cache.set(node, b);
  return b;
}

/** World-space AABB (mm) of all visible nodes, or the room if empty. */
export function sceneBounds(doc: SceneDoc, ids?: string[]): Box3m {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const list = (ids ?? doc.order).map((i) => doc.nodes[i]).filter((n) => n && n.visible && n.type !== 'group');
  for (const n of list) {
    const b = nodeLocalBounds(n);
    const th = (n.rotationY * Math.PI) / 180;
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]])
        for (const z of [b.min[2], b.max[2]]) {
          const wx = n.position[0] + x * c + z * s;
          const wy = n.position[1] + y;
          const wz = n.position[2] - x * s + z * c;
          min[0] = Math.min(min[0], wx); max[0] = Math.max(max[0], wx);
          min[1] = Math.min(min[1], wy); max[1] = Math.max(max[1], wy);
          min[2] = Math.min(min[2], wz); max[2] = Math.max(max[2], wz);
        }
  }
  if (!list.length || !Number.isFinite(min[0])) return roomBox(doc);
  return { min, max };
}

/** Bounds of every floor of the floor-plan model (mm), or null when the plan is empty. */
export function planBox(doc: SceneDoc): Box3m | null {
  const p = doc.plan;
  if (!p?.enabled) return null;
  if (!planHasContent(p)) return { min: [0, 0, 0], max: [6000, 2800, 5000] };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of p.buildings)
    for (const f of b.floors) {
      minY = Math.min(minY, f.elevation);
      maxY = Math.max(maxY, f.elevation + f.height);
      for (const id of f.order) {
        const e = f.entities[id];
        if (!e || e.kind === 'reference' || e.kind === 'guide') continue;
        const bx = entityBounds(f, e);
        if (!bx) continue;
        minX = Math.min(minX, bx.minX); maxX = Math.max(maxX, bx.maxX); minZ = Math.min(minZ, bx.minY); maxZ = Math.max(maxZ, bx.maxY);
      }
    }
  if (!Number.isFinite(minX)) return { min: [0, 0, 0], max: [6000, 2800, 5000] };
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function roomBox(doc: SceneDoc): Box3m {
  const pb = planBox(doc);
  if (pb) return pb;
  const xs = doc.room.points.map((p) => p[0]);
  const zs = doc.room.points.map((p) => p[1]);
  return { min: [Math.min(...xs), 0, Math.min(...zs)], max: [Math.max(...xs), doc.room.height, Math.max(...zs)] };
}
