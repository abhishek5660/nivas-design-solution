import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser, handle, requireUser } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

export const GET = handle(async () => {
  const user = await getUser();
  return NextResponse.json({ user });
});

const schema = z.object({ name: z.string().trim().min(1).max(80) });

export const PATCH = handle(async (req: Request) => {
  const user = await requireUser();
  const body = schema.parse(await req.json());
  const u = await prisma.user.update({ where: { id: user.id }, data: { name: body.name }, select: { id: true, name: true, email: true, role: true } });
  return NextResponse.json({ user: u });
});
