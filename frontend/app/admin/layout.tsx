import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) redirect('/login');
  if (
    session.user.role !== 'ADMIN' &&
    session.user.role !== 'SHOW_SECRETARY' &&
    session.user.role !== 'SHOW_MANAGER'
  ) redirect('/');

  return <>{children}</>;
}
