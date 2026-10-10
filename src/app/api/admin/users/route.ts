import { NextResponse } from 'next/server';
import { handle, requireAdmin } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

export const GET = handle(async () => {
  await requireAdmin();
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, _count: { select: { projects: true } } } });
  return NextResponse.json({ users });
});
