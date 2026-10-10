import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, hashPassword, HttpError, rateLimit, requireUser, verifyPassword } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

const schema = z.object({ current: z.string().min(1).max(200), next: z.string().min(8, 'New password must be at least 8 characters').max(200) });

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  rateLimit(`pw:${user.id}`, 6);
  const body = schema.parse(await req.json());
  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row || !(await verifyPassword(body.current, row.passwordHash))) throw new HttpError(400, 'Your current password is incorrect.');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next) } });
  return NextResponse.json({ ok: true });
});
