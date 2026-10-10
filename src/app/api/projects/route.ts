import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, HttpError, requireDesigner, requireUser } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';
import { starterDoc } from '@/lib/scene';
import { validateDoc } from '@/lib/schema';

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(['WARDROBE', 'KITCHEN', 'TV_PANEL', 'CUSTOM']),
  customer: z.string().max(200).optional(),
  roomNotes: z.string().max(2000).optional(),
  layout: z.enum(['straight', 'l_shape', 'u_shape', 'parallel', 'island']).optional(),
  roomWidth: z.number().min(1500).max(20000).optional(),
  roomDepth: z.number().min(1500).max(20000).optional(),
  roomHeight: z.number().min(2000).max(5000).optional(),
  empty: z.boolean().optional(),
  doc: z.unknown().optional(), // imported / template document
});

export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim();
  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');
  const where = {
    AND: [
      user.role === 'ADMIN' && url.searchParams.get('all') === '1' ? {} : { OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }] },
      q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { customer: { contains: q, mode: 'insensitive' as const } }] } : {},
      category ? { category } : {},
      status ? { status } : {},
    ],
  };
  const projects = await prisma.project.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: { id: true, name: true, category: true, status: true, customer: true, roomNotes: true, thumbnail: true, version: true, createdAt: true, updatedAt: true, ownerId: true, owner: { select: { name: true } } },
  });
  return NextResponse.json({ projects });
});

export const POST = handle(async (req: Request) => {
  const user = await requireDesigner();
  const body = createSchema.parse(await req.json());
  let data;
  if (body.doc) {
    const rep = validateDoc(body.doc);
    if (!rep.ok) throw new HttpError(422, 'The supplied design is invalid.', rep.errors);
    data = rep.doc!;
  } else {
    data = starterDoc(body.category, { layout: body.layout, roomWidth: body.roomWidth, roomDepth: body.roomDepth, roomHeight: body.roomHeight, empty: body.empty });
  }
  const project = await prisma.project.create({
    data: { ownerId: user.id, name: body.name, category: body.category, customer: body.customer ?? '', roomNotes: body.roomNotes ?? '', data: data as object },
    select: { id: true, name: true, category: true, version: true },
  });
  await prisma.revision.create({ data: { projectId: project.id, version: 1, label: 'Created', data: data as object, authorId: user.id } });
  return NextResponse.json({ project }, { status: 201 });
});
