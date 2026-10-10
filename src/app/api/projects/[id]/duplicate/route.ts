import { NextResponse } from 'next/server';
import { handle, loadProjectFor, requireDesigner } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireDesigner();
  const { id } = await params;
  const { project } = await loadProjectFor(user.id, user.role, id, 'read');
  const copy = await prisma.project.create({
    data: { ownerId: user.id, name: `${project.name} (copy)`.slice(0, 160), category: project.category, customer: project.customer, roomNotes: project.roomNotes, data: project.data as object, thumbnail: project.thumbnail },
    select: { id: true, name: true },
  });
  await prisma.revision.create({ data: { projectId: copy.id, version: 1, label: `Duplicated from ${project.name}`.slice(0, 120), data: project.data as object, authorId: user.id } });
  return NextResponse.json({ project: copy }, { status: 201 });
});
