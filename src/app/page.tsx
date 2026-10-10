import { redirect } from 'next/navigation';
import { getUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getUser();
  redirect(user ? '/dashboard' : '/login');
}
