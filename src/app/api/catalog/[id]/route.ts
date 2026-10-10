import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, HttpError, requireDesigner } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

type Ctx = { params: Promise<{ id: string }> };

async function ownItem(userId: string, role: string, id: string) {
  const item = await prisma.catalogItem.findUnique({ where: { id } });
  if (!item || (item.ownerId !== userId && role !== 'ADMIN')) throw new HttpError(404, 'Catalog item not found.');
  return item;
}

const patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().max(80).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  shared: z.boolean().optional(),
  verified: z.boolean().optional(),
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const user = await requireDesigner();
  const { id } = await params;
  await ownItem(user.id, user.role, id);
  const body = patch.parse(await req.json());
  const admin = user.role === 'ADMIN';
  const item = await prisma.catalogItem.update({
    where: { id },
    data: { name: body.name, category: body.category, data: body.data as object | undefined, ...(admin ? { shared: body.shared, verified: body.verified } : {}) },
  });
  return NextResponse.json({ item: { id: item.id } });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const user = await requireDesigner();
  const { id } = await params;
  await ownItem(user.id, user.role, id);
  await prisma.catalogItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
