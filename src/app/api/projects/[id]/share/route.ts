import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, HttpError, loadProjectFor, requireDesigner } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ email: z.string().trim().toLowerCase().email(), access: z.enum(['VIEW', 'EDIT']) });

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireDesigner();
  const { id } = await params;
  await loadProjectFor(user.id, user.role, id, 'read');
  const shares = await prisma.projectShare.findMany({ where: { projectId: id }, include: { user: { select: { email: true, name: true } } } });
  return NextResponse.json({ shares: shares.map((s) => ({ userId: s.userId, access: s.access, email: s.user.email, name: s.user.name })) });
});

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const user = await requireDesigner();
  const { id } = await params;
  const { owner, admin } = await loadProjectFor(user.id, user.role, id, 'write');
  if (!owner && !admin) throw new HttpError(403, 'Only the owner can share a project.');
  const body = schema.parse(await req.json());
  const target = await prisma.user.findUnique({ where: { email: body.email } });
  if (!target) throw new HttpError(404, 'No user with that email. They need to register first.');
  if (target.id === user.id) throw new HttpError(400, 'You already own this project.');
  await prisma.projectShare.upsert({ where: { projectId_userId: { projectId: id, userId: target.id } }, create: { projectId: id, userId: target.id, access: body.access }, update: { access: body.access } });
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (req: Request, { params }: Ctx) => {
  const user = await requireDesigner();
  const { id } = await params;
  const { owner, admin } = await loadProjectFor(user.id, user.role, id, 'write');
  if (!owner && !admin) throw new HttpError(403, 'Only the owner can change sharing.');
  const userId = new URL(req.url).searchParams.get('userId') ?? '';
  await prisma.projectShare.deleteMany({ where: { projectId: id, userId } });
  return NextResponse.json({ ok: true });
});
