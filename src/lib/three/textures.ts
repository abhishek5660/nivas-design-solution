'use client';
import * as THREE from 'three';
import type { MaterialDef, TextureKind } from '../types';

// ---- small deterministic noise helpers ----
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function makeNoise(seed: number, size = 256) {
  const r = mulberry(seed);
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x: number, y: number) => grid[((y & (size - 1)) * size + (x & (size - 1))) | 0];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  // tileable value noise
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

const SIZE = 512;

type Painter = (x: number, y: number, n: (x: number, y: number) => number, base: [number, number, number]) => [number, number, number];

function shade(base: [number, number, number], k: number): [number, number, number] {
  return [clamp255(base[0] * k), clamp255(base[1] * k), clamp255(base[2] * k)];
}

const painters: Record<Exclude<TextureKind, 'none' | 'image'>, Painter> = {
  wood_oak: (x, y, n, b) => {
    const warp = n(x * 0.012, y * 0.05) * 6;
    const rings = Math.sin((y + warp * 10) * 0.09 + n(x * 0.004, y * 0.02) * 9) * 0.5 + 0.5;
    const fine = n(x * 0.3, y * 0.9);
    return shade(b, 0.82 + rings * 0.16 + fine * 0.07);
  },
  wood_walnut: (x, y, n, b) => {
    const warp = n(x * 0.01, y * 0.04) * 8;
    const rings = Math.sin((y + warp * 14) * 0.07 + n(x * 0.003, y * 0.015) * 12) * 0.5 + 0.5;
    return shade(b, 0.7 + rings * 0.3 + n(x * 0.2, y * 0.8) * 0.1);
  },
  wood_teak: (x, y, n, b) => {
    const rings = Math.sin(y * 0.11 + n(x * 0.006, y * 0.03) * 7) * 0.5 + 0.5;
    const streak = n(x * 0.02, y * 1.3);
    return shade(b, 0.78 + rings * 0.18 + streak * 0.14);
  },
  wood_ash: (x, y, n, b) => {
    const rings = Math.sin(y * 0.06 + n(x * 0.005, y * 0.025) * 5) * 0.5 + 0.5;
    return shade(b, 0.9 + rings * 0.08 + n(x * 0.25, y * 1.1) * 0.05);
  },
  laminate_grain: (x, y, n, b) => shade(b, 0.92 + n(x * 0.15, y * 0.9) * 0.1 + n(x * 0.01, y * 0.07) * 0.05),
  marble: (x, y, n, b) => {
    let turb = 0;
    let f = 1;
    for (let o = 0; o < 5; o++) {
      turb += n(x * 0.012 * f, y * 0.012 * f) / f;
      f *= 2;
    }
    const vein = Math.abs(Math.sin((x * 0.5 + y * 0.8) * 0.014 + turb * 7));
    const v = Math.pow(1 - vein, 7);
    const fine = Math.pow(1 - Math.abs(Math.sin((x * 0.9 - y * 0.3) * 0.03 + turb * 11)), 14) * 0.5;
    const lum = (b[0] + b[1] + b[2]) / 3;
    const dark = lum > 120;
    const k = dark ? 1 - (v * 0.45 + fine * 0.2) : 1 + (v * 1.1 + fine * 0.5);
    return shade(b, k * (0.97 + n(x * 0.05, y * 0.05) * 0.06));
  },
  stone: (x, y, n, b) => {
    const speck = n(x * 0.9, y * 0.9);
    const cloud = n(x * 0.02, y * 0.02);
    const sparkle = speck > 0.93 ? 1.35 : speck < 0.08 ? 0.8 : 1;
    return shade(b, (0.9 + cloud * 0.18) * sparkle);
  },
  fluted: (x, y, n, b) => {
    const period = 32;
    const px = (x % period) / period;
    const groove = Math.sin(px * Math.PI);
    const wood = 0.85 + n(x * 0.02, y * 0.6) * 0.15;
    return shade(b, (0.55 + groove * 0.5) * wood);
  },
  slat: (x, y, n, b) => {
    const period = 64;
    const px = (x % period) / period;
    if (px > 0.82) return shade(b, 0.22);
    const wood = 0.85 + n(x * 0.03, y * 0.4) * 0.2 + Math.sin(y * 0.05 + n(x * 0.01, y * 0.02) * 6) * 0.05;
    return shade(b, wood * (0.92 + (px > 0.74 ? -0.1 : 0)));
  },
  brushed_metal: (x, y, n, b) => shade(b, 0.88 + n(x * 0.02, y * 2.2) * 0.2),
  fabric: (x, y, n, b) => {
    const weave = (Math.sin(x * 1.3) * Math.sin(y * 1.3) + 1) * 0.5;
    return shade(b, 0.85 + weave * 0.1 + n(x * 0.4, y * 0.4) * 0.12);
  },
};

const texCache = new Map<string, THREE.CanvasTexture>();
const imgCache = new Map<string, THREE.Texture>();

export function getProceduralTexture(def: MaterialDef): THREE.CanvasTexture | null {
  if (def.texture === 'none' || def.texture === 'image') return null;
  const key = `${def.texture}|${def.color}`;
  let t = texCache.get(key);
  if (t) return t;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  const base = hex(def.color);
  const noise = makeNoise(hash(def.texture + def.color));
  const paint = painters[def.texture];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = paint(x, y, noise, base);
      const i = (y * SIZE + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

/** Uploaded assets are private; the public preview passes its share token so they can load. */
export function assetUrl(url: string): string {
  const tok = (globalThis as unknown as { __nivasShare?: string }).__nivasShare;
  return tok && url.startsWith('/api/assets/') ? `${url}?share=${tok}` : url;
}

export function getImageTexture(url: string): THREE.Texture {
  let t = imgCache.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(assetUrl(url), () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('nivas-invalidate'));
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    imgCache.set(url, t);
  }
  return t;
}

const matCache = new Map<string, THREE.MeshPhysicalMaterial>();

export function getThreeMaterial(def: MaterialDef): THREE.MeshPhysicalMaterial {
  const key = JSON.stringify([def.id, def.color, def.roughness, def.metalness, def.opacity, def.texture, def.textureUrl, def.emissive]);
  let m = matCache.get(key);
  if (m) return m;
  const map = def.texture === 'image' && def.textureUrl ? getImageTexture(def.textureUrl) : getProceduralTexture(def);
  const glass = def.opacity != null && def.opacity < 1;
  m = new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : new THREE.Color(def.color),
    map: map ?? null,
    roughness: def.roughness,
    metalness: def.metalness,
    transparent: glass,
    opacity: def.opacity ?? 1,
    envMapIntensity: def.metalness > 0.5 ? 1.4 : glass ? 1.6 : 0.8,
    clearcoat: def.roughness < 0.2 && def.metalness < 0.5 && !glass ? 0.6 : 0,
    clearcoatRoughness: 0.08,
    side: glass ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: !glass,
    emissive: def.emissive ? new THREE.Color(def.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: def.emissive ? 0.85 : 0,
  });
  if (map && (def.texture === 'fluted' || def.texture === 'slat' || def.texture === 'fabric')) m.bumpMap = map;
  if (m.bumpMap) m.bumpScale = 1.2;
  matCache.set(key, m);
  return m;
}

export function disposeAllMaterials() {
  matCache.forEach((m) => m.dispose());
  matCache.clear();
  texCache.forEach((t) => t.dispose());
  texCache.clear();
}

// ---- geometry with real-world UVs ----
const geoCache = new Map<string, THREE.BufferGeometry>();
const MAX_GEO = 1500;

/**
 * Box whose UVs are in "tiles" of `tileMm`, with the grain direction (u) aligned to the longest
 * face dimension so that wood runs along the length of a board.
 */
export function boxGeometry(w: number, h: number, d: number, tileMm = 1000, grain: 'length' | 'width' | 'none' = 'length'): THREE.BufferGeometry {
  const key = `${w}|${h}|${d}|${tileMm}|${grain}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  if (geoCache.size > MAX_GEO) {
    geoCache.forEach((g) => g.dispose());
    geoCache.clear();
  }
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry face order: +x,-x,+y,-y,+z,-z; each 4 verts. Face dims (u,v):
  const faces: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  faces.forEach(([fu, fv], fi) => {
    const swap = grain === 'width' ? fu > fv : fv > fu;
    for (let k = 0; k < 4; k++) {
      const i = fi * 4 + k;
      const u0 = uv.getX(i);
      const v0 = uv.getY(i);
      if (swap) uv.setXY(i, (v0 * fv) / tileMm, (u0 * fu) / tileMm);
      else uv.setXY(i, (u0 * fu) / tileMm, (v0 * fv) / tileMm);
    }
  });
  uv.needsUpdate = true;
  geoCache.set(key, g);
  return g;
}

export function cylinderGeometry(dia: number, len: number): THREE.BufferGeometry {
  const key = `cyl|${dia}|${len}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = new THREE.CylinderGeometry(dia / 2, dia / 2, len, 20);
  geoCache.set(key, g);
  return g;
}

export function disposeGeometryCache() {
  geoCache.forEach((g) => g.dispose());
  geoCache.clear();
}
