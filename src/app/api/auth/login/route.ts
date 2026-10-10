import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, handle, HttpError, rateLimit, verifyPassword } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export const POST = handle(async (req: Request) => {
  const body = schema.parse(await req.json());
  rateLimit(`login:${body.email}`, 8);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !user.active || !(await verifyPassword(body.password, user.passwordHash))) throw new HttpError(401, 'Incorrect email or password.');
  await createSession(user.id);
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});
