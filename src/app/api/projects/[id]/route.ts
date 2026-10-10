import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, HttpError, loadProjectFor, requireUser } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';
import { validateDoc } from '@/lib/schema';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const { project, access } = await loadProjectFor(user.id, user.role, id, 'read');
  const { shares, ...rest } = project;
  void shares;
  return NextResponse.json({ project: rest, access });
});

const saveSchema = z.object({
  data: z.unknown(),
  baseVersion: z.number().int().min(1),
  thumbnail: z.string().max(400_000).startsWith('data:image/').nullable().optional(),
  revisionLabel: z.string().max(120).optional(),
});

/** Save the design. Only returns success once the database has committed the new version. */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const { project } = await loadProjectFor(user.id, user.role, id, 'write');
  const raw = await req.text();
  if (raw.length > 8_000_000) throw new HttpError(413, 'The design is too large to save (8 MB limit).');
  const body = saveSchema.parse(JSON.parse(raw));
  const rep = validateDoc(body.data);
  if (!rep.ok) throw new HttpError(422, 'The design contains invalid data and was not saved.', rep.errors);
  if (body.baseVersion !== project.version) {
    throw new HttpError(409, 'This project was changed elsewhere (another tab or user). Reload to get the latest version.', { serverVersion: project.version });
  }
  const next = project.version + 1;
  const res = await prisma.project.updateMany({
    where: { id, version: body.baseVersion },
    data: { data: rep.doc as object, version: next, ...(body.thumbnail !== undefined ? { thumbnail: body.thumbnail } : {}) },
  });
  if (res.count !== 1) throw new HttpError(409, 'This project was changed elsewhere. Reload to get the latest version.');
  if (body.revisionLabel !== undefined) {
    await prisma.revision.create({ data: { projectId: id, version: next, label: body.revisionLabel, data: rep.doc as object, authorId: user.id } });
    const old = await prisma.revision.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, skip: 60, select: { id: true } });
    if (old.length) await prisma.revision.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }
  const updated = await prisma.project.findUnique({ where: { id }, select: { version: true, updatedAt: true } });
  return NextResponse.json({ ok: true, version: updated!.version, updatedAt: updated!.updatedAt, warnings: rep.warnings });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'IN_PRODUCTION', 'COMPLETED']).optional(),
  customer: z.string().max(200).optional(),
  roomNotes: z.string().max(2000).optional(),
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  await loadProjectFor(user.id, user.role, id, 'write');
  const body = patchSchema.parse(await req.json());
  const project = await prisma.project.update({ where: { id }, data: body, select: { id: true, name: true, status: true, customer: true, roomNotes: true, updatedAt: true } });
  return NextResponse.json({ project });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id } = await params;
  const { owner, admin } = await loadProjectFor(user.id, user.role, id, 'write');
  if (!owner && !admin) throw new HttpError(403, 'Only the owner can delete a project.');
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
