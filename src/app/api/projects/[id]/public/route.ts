import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { handle, HttpError, loadProjectFor, requireDesigner } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

type Ctx = { params: Promise<{ id: string }> };

/** Enable (or fetch) the public read-only preview link for a project. */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireDesigner();
  const { id } = await params;
  const { project, owner, admin } = await loadProjectFor(user.id, user.role, id, 'write');
  if (!owner && !admin) throw new HttpError(403, 'Only the owner can publish a preview link.');
  const token = project.shareToken ?? randomBytes(18).toString('base64url');
  if (!project.shareToken) await prisma.project.update({ where: { id }, data: { shareToken: token } });
  return NextResponse.json({ token, path: `/share/${token}` });
});

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireDesigner();
  const { id } = await params;
  const { project } = await loadProjectFor(user.id, user.role, id, 'read');
  return NextResponse.json({ token: project.shareToken, path: project.shareToken ? `/share/${project.shareToken}` : null });
});

/** Revoke the link: previously shared URLs stop working immediately. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireDesigner();
  const { id } = await params;
  const { owner, admin } = await loadProjectFor(user.id, user.role, id, 'write');
  if (!owner && !admin) throw new HttpError(403, 'Only the owner can revoke the preview link.');
  await prisma.project.update({ where: { id }, data: { shareToken: null } });
  return NextResponse.json({ ok: true });
});
