import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = (session?.user as any)?.role;

  if (!session?.user) redirect('/login');
  if (role !== 'ADMIN' && role !== 'SHOW_SECRETARY') redirect('/');

  return <>{children}</>;
}
