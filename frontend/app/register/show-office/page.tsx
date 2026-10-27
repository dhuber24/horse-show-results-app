import ShowOfficeRegisterForm, { type OfficeRole } from './ShowOfficeRegisterForm';
import Link from 'next/link';

/**
 * `?role=` only preselects the choice on the form, so the old
 * `/register/show-manager` and `/register/show-secretary` links, which redirect
 * here, land on the role they named. Anybody can still pick either.
 */
const ROLE_PARAM: Record<string, OfficeRole> = {
  manager: 'SHOW_MANAGER',
  secretary: 'SHOW_SECRETARY',
};

export default async function ShowOfficeRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  const initialRole = role ? ROLE_PARAM[role] : undefined;

  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--background)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-5xl">📋</span>
          <h1 className="text-2xl font-bold mt-3" style={{ color: 'var(--foreground)' }}>Show Office Registration</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Create an account to run horse shows, their entries and their results
          </p>
        </div>
        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <ShowOfficeRegisterForm initialRole={initialRole} />
        </div>
        <div className="text-center text-sm mt-4 space-y-1">
          <p style={{ color: 'var(--muted)' }}>
            Already have an account?{' '}
            <Link href="/login" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Sign in
            </Link>
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Registering as an exhibitor?{' '}
            <Link href="/register" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Exhibitor registration
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
