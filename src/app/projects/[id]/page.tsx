import { redirect, notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Editor } from '@/components/editor/Editor';
import { getUser, HttpError, loadProjectFor } from '@/lib/server/auth';
import { validateDoc } from '@/lib/schema';
import { Spinner } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Design workspace' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const { id } = await params;
  let loaded;
  try {
    loaded = await loadProjectFor(user.id, user.role, id, 'read');
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const { project, access } = loaded;
  const rep = validateDoc(project.data);
  if (!rep.ok) {
    return (
      <main className="mx-auto max-w-xl p-10">
        <h1 className="font-display text-3xl font-semibold">This project could not be opened</h1>
        <p className="mt-2 text-sm text-mute">The saved design failed validation, so it was not loaded (nothing was changed). Restore an earlier version from History or contact an administrator.</p>
        <ul className="mt-3 list-disc pl-5 text-sm text-danger">{rep.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
      </main>
    );
  }
  const meta = { id: project.id, name: project.name, category: project.category, status: project.status, customer: project.customer, roomNotes: project.roomNotes, updatedAt: project.updatedAt.toISOString() };
  return (
    <Suspense fallback={<div className="grid h-screen place-items-center"><Spinner size={32} /></div>}>
      <Editor meta={meta} doc={rep.doc!} version={project.version} access={access === 'OWNER' ? 'OWNER' : access === 'EDIT' ? 'EDIT' : 'VIEW'} />
    </Suspense>
  );
}
