import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, handle, hashPassword, HttpError, rateLimit } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const POST = handle(async (req: Request) => {
  const ip = req.headers.get('x-forwarded-for') ?? 'local';
  rateLimit(`register:${ip}`, 10);
  const body = schema.parse(await req.json());
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw new HttpError(409, 'An account with this email already exists.');
  const count = await prisma.user.count();
  if (count > 0) {
    const row = await prisma.setting.findUnique({ where: { key: 'allowRegistration' } });
    if (row && row.value === false) throw new HttpError(403, 'Registration is closed. Ask an administrator to create your account.');
  }
  const role = count === 0 && process.env.FIRST_USER_IS_ADMIN !== 'false' ? 'ADMIN' : 'DESIGNER';
  const user = await prisma.user.create({ data: { name: body.name, email: body.email, passwordHash: await hashPassword(body.password), role } });
  await createSession(user.id);
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, { status: 201 });
});
