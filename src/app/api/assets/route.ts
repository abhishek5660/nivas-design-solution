import { NextResponse } from 'next/server';
import { handle, HttpError, requireDesigner } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

const MAX = 8 * 1024 * 1024;
const ALLOWED: Record<string, { mime: string; magic: (b: Uint8Array) => boolean }> = {
  png: { mime: 'image/png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  jpg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  jpeg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  webp: { mime: 'image/webp', magic: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 },
  glb: { mime: 'model/gltf-binary', magic: (b) => b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46 },
};

/** Upload a texture image or GLB model. Type is verified by extension AND file signature. */
export const POST = handle(async (req: Request) => {
  const user = await requireDesigner();
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file was uploaded.');
  if (file.size === 0) throw new HttpError(400, 'The file is empty.');
  if (file.size > MAX) throw new HttpError(413, 'Files must be 8 MB or smaller.');
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const rule = ALLOWED[ext];
  if (!rule) throw new HttpError(415, 'Allowed formats: PNG, JPG, WEBP images and GLB 3D models.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!rule.magic(bytes)) throw new HttpError(415, `This file is not a valid ${ext.toUpperCase()} (the contents do not match the extension).`);
  if (ext === 'glb') {
    // header: magic, version(2), total length must match
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 20 || dv.getUint32(4, true) !== 2 || dv.getUint32(8, true) !== bytes.byteLength) throw new HttpError(415, 'The GLB file header is damaged or not glTF 2.0.');
  }
  const asset = await prisma.asset.create({ data: { ownerId: user.id, name: file.name.slice(0, 120), mime: rule.mime, size: file.size, bytes: Buffer.from(bytes) }, select: { id: true, name: true, mime: true, size: true } });
  return NextResponse.json({ asset: { ...asset, url: `/api/assets/${asset.id}` } }, { status: 201 });
});

export const GET = handle(async () => {
  const user = await requireDesigner();
  const assets = await prisma.asset.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, name: true, mime: true, size: true, createdAt: true } });
  return NextResponse.json({ assets: assets.map((a) => ({ ...a, url: `/api/assets/${a.id}` })) });
});
