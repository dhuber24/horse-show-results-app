import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Breadcrumbs from '@/components/Breadcrumbs';
import DuplicatesManager from './DuplicatesManager';
import RegistryList from './RegistryList';

/**
 * The exhibitor records, and the ones that are the same person twice.
 *
 * **An exhibitor record is not a user**, and that gap is what this page exists
 * to close. `/admin/users` is logins — roles, approval, passwords — and
 * somebody the show office typed in at a registration desk has none of that
 * deliberately: an account belongs to whoever will sign in to it, and the
 * office's job is to get a walk-up entered, not to invent them a password. So
 * since migration 140 there are real exhibitors with back numbers, entries and
 * bills that the Users screen will never show, and before this page there was
 * nowhere in the app that did.
 *
 * Two sections, in the order the questions get asked. **Duplicates** first,
 * because a duplicate is work somebody has to do; the full **registry** below
 * it, because a record the office cannot find is one it types in again — which
 * is how the duplicate above gets made in the first place.
 */
export default async function AdminExhibitorsPage() {
  // The admin layout admits secretaries and managers, and `POST
  // /exhibitors/{id}/merge` is ADMIN-only — so without this a secretary who
  // reached the URL would get a working list and a 403 on the one button.
  // Their own merge is the desk's, scoped to the show they are working.
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== 'ADMIN') redirect('/admin');

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Exhibitor Records' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
          Exhibitor Records
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Everyone the app holds as an exhibitor. People a show office typed in at a registration
          desk have no login, so they appear here and not under Users.
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
            On file more than once
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Usually a record the office typed in at a desk and the account that person opened
            afterwards. Joining them moves every entry, back number, horse, membership and
            payment onto the record you keep.
          </p>
        </div>
        <DuplicatesManager />
      </section>

      <RegistryList />
    </main>
  );
}
