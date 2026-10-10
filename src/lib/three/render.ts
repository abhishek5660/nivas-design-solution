'use client';
import * as THREE from 'three';
import { viewportApi } from '@/components/editor/Viewport';

export interface StillOptions {
  width: number;
  height: number;
  samples: number;
  format: 'png' | 'jpeg';
  onProgress: (done: number, total: number) => void;
  signal: AbortSignal;
}

export class RenderError extends Error {}

const halton = (i: number, b: number) => {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
};

function ensureReady() {
  const { gl, scene, camera } = viewportApi;
  if (!gl || !scene || !camera) throw new RenderError('The 3D view is not available. Switch to the Design tab and try again.');
  return { gl, scene, camera };
}

function withUiHidden<T>(scene: THREE.Scene, fn: () => T): T {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData?.uiOnly && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  try {
    return fn();
  } finally {
    hidden.forEach((o) => (o.visible = true));
  }
}

function checkLimits(gl: THREE.WebGLRenderer, w: number, h: number) {
  const max = Math.min(gl.capabilities.maxTextureSize, (gl.getContext().getParameter(gl.getContext().MAX_RENDERBUFFER_SIZE) as number) || Infinity);
  if (w > max || h > max) throw new RenderError(`This GPU supports renders up to ${max} px. Choose a smaller size.`);
  if (gl.getContext().isContextLost()) throw new RenderError('The graphics context was lost. Reload the page and try again.');
}

/**
 * Progressive supersampled render: N sub-pixel-jittered frames with the sun jittered inside a small cone
 * (soft shadows), averaged into one image. This is a rasteriser, not a path tracer.
 */
export async function renderStill(o: StillOptions): Promise<Blob> {
  const { gl, scene, camera } = ensureReady();
  checkLimits(gl, o.width, o.height);
  const prev = { size: gl.getSize(new THREE.Vector2()), ratio: gl.getPixelRatio() };
  const persp = camera instanceof THREE.PerspectiveCamera ? camera : null;
  const ortho = camera instanceof THREE.OrthographicCamera ? camera : null;
  const prevAspect = persp?.aspect;
  const prevOrtho = ortho ? { l: ortho.left, r: ortho.right, t: ortho.top, b: ortho.bottom } : null;
  const sun = (() => {
    let l: THREE.DirectionalLight | null = null;
    scene.traverse((x) => {
      if (!l && (x as THREE.DirectionalLight).isDirectionalLight && (x as THREE.DirectionalLight).castShadow) l = x as THREE.DirectionalLight;
    });
    return l as THREE.DirectionalLight | null;
  })();
  const sunPos = sun?.position.clone();
  const acc = document.createElement('canvas');
  acc.width = o.width;
  acc.height = o.height;
  const ctx = acc.getContext('2d');
  if (!ctx) throw new RenderError('Could not allocate the render buffer (image too large for this browser).');
  viewportApi.pause?.(true);
  try {
    gl.setPixelRatio(1);
    gl.setSize(o.width, o.height, false);
    if (persp) {
      persp.aspect = o.width / o.height;
      persp.updateProjectionMatrix();
    }
    if (ortho) {
      const hh = (ortho.top - ortho.bottom) / 2;
      const ar = o.width / o.height;
      ortho.left = -hh * ar;
      ortho.right = hh * ar;
      ortho.updateProjectionMatrix();
    }
    for (let i = 0; i < o.samples; i++) {
      if (o.signal.aborted) throw new RenderError('Render cancelled.');
      const jx = halton(i + 1, 2) - 0.5;
      const jy = halton(i + 1, 3) - 0.5;
      (camera as THREE.PerspectiveCamera).setViewOffset(o.width, o.height, jx, jy, o.width, o.height);
      if (sun && sunPos) {
        const a = halton(i + 1, 5) * Math.PI * 2;
        const r = Math.sqrt(halton(i + 1, 7)) * 0.045;
        sun.position.set(sunPos.x + Math.cos(a) * r * sunPos.length(), sunPos.y, sunPos.z + Math.sin(a) * r * sunPos.length());
        sun.updateMatrixWorld();
      }
      withUiHidden(scene, () => gl.render(scene, camera));
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(gl.domElement, 0, 0);
      o.onProgress(i + 1, o.samples);
      await new Promise((r) => setTimeout(r, 0));
    }
    ctx.globalAlpha = 1;
    return await new Promise<Blob>((res, rej) => acc.toBlob((b) => (b ? res(b) : rej(new RenderError('Could not encode the image.'))), o.format === 'png' ? 'image/png' : 'image/jpeg', 0.93));
  } finally {
    (camera as THREE.PerspectiveCamera).clearViewOffset();
    if (sun && sunPos) sun.position.copy(sunPos);
    gl.setPixelRatio(prev.ratio);
    gl.setSize(prev.size.x, prev.size.y, false);
    if (persp && prevAspect) {
      persp.aspect = prevAspect;
      persp.updateProjectionMatrix();
    }
    if (ortho && prevOrtho) {
      ortho.left = prevOrtho.l;
      ortho.right = prevOrtho.r;
      ortho.top = prevOrtho.t;
      ortho.bottom = prevOrtho.b;
      ortho.updateProjectionMatrix();
    }
    viewportApi.pause?.(false);
  }
}

/** 360° equirectangular panorama from the given eye position (metres). */
export async function renderPanorama(o: { width: number; eye: [number, number, number]; format: 'png' | 'jpeg'; onProgress: (d: number, t: number) => void; signal: AbortSignal }): Promise<Blob> {
  const { gl, scene } = ensureReady();
  const face = Math.min(2048, Math.max(512, Math.round(o.width / 4)));
  checkLimits(gl, face, face);
  const W = o.width;
  const H = Math.round(o.width / 2);
  const prev = { size: gl.getSize(new THREE.Vector2()), ratio: gl.getPixelRatio() };
  const dirs: { f: THREE.Vector3; u: THREE.Vector3 }[] = [
    { f: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0) },
    { f: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, 1, 0) },
    { f: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(0, 0, -1) },
    { f: new THREE.Vector3(0, -1, 0), u: new THREE.Vector3(0, 0, 1) },
    { f: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(0, 1, 0) },
    { f: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(0, 1, 0) },
  ];
  const cam = new THREE.PerspectiveCamera(90, 1, 0.05, 120);
  cam.position.set(...o.eye);
  const faces: ImageData[] = [];
  viewportApi.pause?.(true);
  try {
    gl.setPixelRatio(1);
    gl.setSize(face, face, false);
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = face;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    if (!tctx) throw new RenderError('Could not allocate buffers for the panorama.');
    for (let i = 0; i < 6; i++) {
      if (o.signal.aborted) throw new RenderError('Render cancelled.');
      cam.up.copy(dirs[i].u);
      cam.lookAt(cam.position.clone().add(dirs[i].f));
      cam.updateMatrixWorld();
      withUiHidden(scene, () => gl.render(scene, cam));
      tctx.drawImage(gl.domElement, 0, 0);
      faces.push(tctx.getImageData(0, 0, face, face));
      o.onProgress(i + 1, 7);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    gl.setPixelRatio(prev.ratio);
    gl.setSize(prev.size.x, prev.size.y, false);
    viewportApi.pause?.(false);
  }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  if (!octx) throw new RenderError('Could not allocate the panorama image.');
  const img = octx.createImageData(W, H);
  const basis = dirs.map((d) => ({ f: d.f, u: d.u, r: new THREE.Vector3().crossVectors(d.f, d.u).normalize() }));
  const d = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W - 0.5) * Math.PI * 2;
      d.set(Math.sin(lon) * Math.cos(lat), Math.sin(lat), -Math.cos(lon) * Math.cos(lat));
      let best = 0;
      let bd = -2;
      for (let k = 0; k < 6; k++) {
        const dot = d.dot(basis[k].f);
        if (dot > bd) {
          bd = dot;
          best = k;
        }
      }
      const b = basis[best];
      const sx = d.dot(b.r) / bd;
      const sy = d.dot(b.u) / bd;
      const px = Math.min(face - 1, Math.max(0, Math.floor((0.5 + 0.5 * sx) * face)));
      const py = Math.min(face - 1, Math.max(0, Math.floor((0.5 - 0.5 * sy) * face)));
      const si = (py * face + px) * 4;
      const di = (y * W + x) * 4;
      const fd = faces[best].data;
      img.data[di] = fd[si];
      img.data[di + 1] = fd[si + 1];
      img.data[di + 2] = fd[si + 2];
      img.data[di + 3] = 255;
    }
    if (y % 128 === 0) {
      if (o.signal.aborted) throw new RenderError('Render cancelled.');
      o.onProgress(6 + y / H, 7);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  octx.putImageData(img, 0, 0);
  o.onProgress(7, 7);
  return await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new RenderError('Could not encode the panorama.'))), o.format === 'png' ? 'image/png' : 'image/jpeg', 0.92));
}
