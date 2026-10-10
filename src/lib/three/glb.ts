'use client';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const MAX_TRIANGLES = 600_000;

export interface GlbInfo {
  size: { w: number; h: number; d: number }; // millimetres (model units assumed metres)
  triangles: number;
}

/** Parses a GLB in the browser to validate it and measure it. Throws a user-readable Error. */
export async function inspectGlb(file: File): Promise<GlbInfo> {
  if (!/\.glb$/i.test(file.name)) throw new Error('Only binary glTF (.glb) files can be imported.');
  if (file.size > 8 * 1024 * 1024) throw new Error('The model is larger than 8 MB.');
  const buf = await file.arrayBuffer();
  const gltf = await new Promise<{ scene: THREE.Group }>((res, rej) => new GLTFLoader().parse(buf, '', res as never, (e) => rej(new Error(`This is not a valid glTF 2.0 file (${(e as { message?: string }).message ?? 'parse error'}).`))));
  let triangles = 0;
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
  });
  if (triangles === 0) throw new Error('The model contains no mesh geometry.');
  if (triangles > MAX_TRIANGLES) throw new Error(`The model has ${Math.round(triangles).toLocaleString()} triangles; the limit is ${MAX_TRIANGLES.toLocaleString()}. Simplify it first.`);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const s = box.getSize(new THREE.Vector3()).multiplyScalar(1000);
  if (!Number.isFinite(s.x + s.y + s.z) || s.x < 1 || s.y < 1 || s.z < 1) throw new Error('The model has no measurable size.');
  const clamp = (v: number) => Math.min(6000, Math.max(10, Math.round(v)));
  return { size: { w: clamp(s.x), h: clamp(s.y), d: clamp(s.z) }, triangles: Math.round(triangles) };
}
