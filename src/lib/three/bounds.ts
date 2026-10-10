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
  if (!list.length || !Number.isFinite(min[0])) {
    const xs = doc.room.points.map((p) => p[0]);
    const zs = doc.room.points.map((p) => p[1]);
    return { min: [Math.min(...xs), 0, Math.min(...zs)], max: [Math.max(...xs), doc.room.height, Math.max(...zs)] };
  }
  return { min, max };
}

export function roomBox(doc: SceneDoc): Box3m {
  const xs = doc.room.points.map((p) => p[0]);
  const zs = doc.room.points.map((p) => p[1]);
  return { min: [Math.min(...xs), 0, Math.min(...zs)], max: [Math.max(...xs), doc.room.height, Math.max(...zs)] };
}
