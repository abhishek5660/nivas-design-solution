import { handle, HttpError, requireUser } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

/** Assets are only readable by signed-in users (textures are referenced from private projects). */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const share = new URL(req.url).searchParams.get('share');
  if (share) {
    // public preview: only assets that the shared project's design actually references
    const proj = await prisma.project.findUnique({ where: { shareToken: share }, select: { data: true } });
    if (!proj || !JSON.stringify(proj.data).includes(`/api/assets/${id}`)) throw new HttpError(404, 'Asset not found.');
  } else await requireUser();
  const a = await prisma.asset.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, 'Asset not found.');
  return new Response(new Uint8Array(a.bytes), { headers: { 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
});

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await params;
  const a = await prisma.asset.findUnique({ where: { id }, select: { ownerId: true } });
  if (!a || (a.ownerId !== user.id && user.role !== 'ADMIN')) throw new HttpError(404, 'Asset not found.');
  await prisma.asset.delete({ where: { id } });
  return Response.json({ ok: true });
});
