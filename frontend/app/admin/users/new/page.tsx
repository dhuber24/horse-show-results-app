import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import CreateUserForm from '../CreateUserForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function NewUserPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const user = session.user as any;
  if (user.role !== 'ADMIN') redirect('/admin');

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-8">
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Users', href: '/admin/users' },
          { label: 'New User' },
        ]} />
        <h1 className="text-3xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Add User</h1>
      </div>

      <div className="p-5 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <CreateUserForm />
      </div>
    </main>
  );
}
