import { notFound } from 'next/navigation';
import { PublicViewer } from '@/components/PublicViewer';
import { prisma } from '@/lib/server/db';
import { validateDoc } from '@/lib/schema';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shared design preview', robots: { index: false, follow: false } };

/** Public, read-only preview reachable only through the unguessable token (revocable by the owner). */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const project = await prisma.project.findUnique({ where: { shareToken: token }, select: { id: true, name: true, category: true, customer: true, data: true, version: true, updatedAt: true } });
  if (!project) notFound();
  const rep = validateDoc(project.data);
  if (!rep.ok) notFound();
  return <PublicViewer token={token} name={project.name} category={project.category} doc={rep.doc!} version={project.version} updatedAt={project.updatedAt.toISOString()} />;
}
