import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import CreateUserForm from '../CreateUserForm';

export default async function NewUserPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const user = session.user as any;
  if (user.role !== 'ADMIN') redirect('/admin');

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold" style={{ color: '#2c1810' }}>Add User</h1>
        <Link href="/admin/users" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Users
        </Link>
      </div>

      <div className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <CreateUserForm />
      </div>
    </main>
  );
}
