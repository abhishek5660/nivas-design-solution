import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, requireDesigner, requireUser } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

export const catalogKinds = ['MATERIAL', 'HARDWARE', 'COMPONENT', 'TEMPLATE', 'THEME'] as const;

/** Lists the user's own items plus anything an administrator has shared with everyone. */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const kind = new URL(req.url).searchParams.get('kind');
  const items = await prisma.catalogItem.findMany({
    where: { AND: [{ OR: [{ ownerId: user.id }, { shared: true }] }, kind ? { kind } : {}] },
    orderBy: { updatedAt: 'desc' },
    take: 500,
    include: { owner: { select: { name: true } } },
  });
  return NextResponse.json({
    items: items.map((i) => ({ id: i.id, kind: i.kind, category: i.category, name: i.name, data: i.data, shared: i.shared, verified: i.verified, mine: i.ownerId === user.id, owner: i.owner?.name ?? 'NIVAS', updatedAt: i.updatedAt })),
  });
});

const schema = z.object({
  kind: z.enum(catalogKinds),
  name: z.string().trim().min(1).max(120),
  category: z.string().max(80).optional(),
  data: z.record(z.string(), z.unknown()),
  shared: z.boolean().optional(),
});

export const POST = handle(async (req: Request) => {
  const user = await requireDesigner();
  const body = schema.parse(await req.json());
  if (JSON.stringify(body.data).length > 2_000_000) return NextResponse.json({ error: 'Item is too large.' }, { status: 413 });
  const item = await prisma.catalogItem.create({
    data: { ownerId: user.id, kind: body.kind, name: body.name, category: body.category ?? '', data: body.data as object, shared: user.role === 'ADMIN' ? !!body.shared : false },
  });
  return NextResponse.json({ item: { id: item.id } }, { status: 201 });
});
