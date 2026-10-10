import { NextResponse } from 'next/server';
import { handle, HttpError, loadProjectFor, requireUser } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

type Ctx = { params: Promise<{ id: string; rid: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id, rid } = await params;
  await loadProjectFor(user.id, user.role, id, 'read');
  const rev = await prisma.revision.findFirst({ where: { id: rid, projectId: id } });
  if (!rev) throw new HttpError(404, 'Revision not found.');
  return NextResponse.json({ revision: rev });
});

/** Restore: writes the revision data as a new current version (history is never rewritten). */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { id, rid } = await params;
  const { project } = await loadProjectFor(user.id, user.role, id, 'write');
  const rev = await prisma.revision.findFirst({ where: { id: rid, projectId: id } });
  if (!rev) throw new HttpError(404, 'Revision not found.');
  const next = project.version + 1;
  await prisma.project.update({ where: { id }, data: { data: rev.data as object, version: next } });
  const label = `Restored from v${rev.version}${rev.label ? ` (${rev.label})` : ''}`.slice(0, 120);
  await prisma.revision.create({ data: { projectId: id, version: next, label, data: rev.data as object, authorId: user.id } });
  return NextResponse.json({ ok: true, version: next });
});
