import { NextResponse } from 'next/server';
import { handle, loadProjectFor, requireUser } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await params;
  await loadProjectFor(user.id, user.role, id, 'read');
  const revisions = await prisma.revision.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, version: true, label: true, createdAt: true, authorId: true } });
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(revisions.map((r) => r.authorId))] } }, select: { id: true, name: true } });
  const name = new Map(authors.map((a) => [a.id, a.name]));
  return NextResponse.json({ revisions: revisions.map((r) => ({ ...r, author: name.get(r.authorId) ?? 'Unknown' })) });
});
