import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { getUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar user={user} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-5 py-7 lg:px-9">{children}</div>
      </main>
    </div>
  );
}
