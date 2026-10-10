import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, HttpError, requireAdmin } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

const schema = z.object({ role: z.enum(['ADMIN', 'DESIGNER', 'VIEWER']).optional(), active: z.boolean().optional() });

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const body = schema.parse(await req.json());
  if (id === admin.id && (body.role && body.role !== 'ADMIN')) throw new HttpError(400, 'You cannot remove your own administrator role.');
  if (id === admin.id && body.active === false) throw new HttpError(400, 'You cannot deactivate your own account.');
  const user = await prisma.user.update({ where: { id }, data: body, select: { id: true, role: true, active: true } });
  return NextResponse.json({ user });
});
