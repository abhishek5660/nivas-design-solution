import { redirect } from 'next/navigation';
import { AdminView } from '@/components/AdminView';
import { PageHeader } from '@/components/ui';
import { getUser } from '@/lib/server/auth';

export const metadata = { title: 'Administration' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = (await getUser())!;
  if (user.role !== 'ADMIN') redirect('/dashboard');
  return (
    <>
      <PageHeader title="Administration" subtitle="Users, roles, project status, pricing rules and shared catalogs." />
      <AdminView meId={user.id} />
    </>
  );
}
