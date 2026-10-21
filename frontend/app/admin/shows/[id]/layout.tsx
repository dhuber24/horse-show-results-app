import Link from 'next/link';
import { auth } from '@/auth';
import { getAuthHeaders } from '@/lib/backend-fetch';
import { fetchShowPlan } from '@/lib/show-companies';
import Breadcrumbs from '@/components/Breadcrumbs';

/**
 * Every office screen of a show, frozen in one place while its company's
 * GaitDesk Pro+ renewal is unpaid (migration 175).
 *
 * A company on Pro+ renews Pro+; from the day after its year ends until it
 * pays or picks Basic or Pro, each of its shows that had not finished by then
 * -- one running mid-show included -- is frozen. The backend refuses every
 * office, gate and scribe request for it (`show_freeze`); this says why in
 * place of a page that would only fail to load. Somebody in the show's company
 * is sent to My Company, where both ways out are; a guest secretary is told
 * whose call it is. A GaitDesk admin is never frozen, and sees the page under
 * a banner so support can see what the customer can't.
 */
export default async function ShowOfficeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plan = await fetchShowPlan(id, await getAuthHeaders());
  if (!plan?.frozen_message) return <>{children}</>;

  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const notice = (
    <p
      role="status"
      className="text-sm rounded border p-3"
      style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}
    >
      <span className="font-semibold">This show is frozen.</span> {plan.frozen_message}
    </p>
  );

  if (role === 'ADMIN') {
    return (
      <>
        <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4">{notice}</div>
        {children}
      </>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: 'Frozen show' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
          This show is frozen
        </h1>
      </div>
      <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)' }}>
        <p className="text-sm" style={{ color: 'var(--text-deep)' }}>{plan.frozen_message}</p>
        {plan.can_request_upgrade ? (
          <Link
            href="/admin/my-company"
            className="inline-block px-4 py-2 rounded text-sm font-semibold"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Renew or choose a plan on My Company
          </Link>
        ) : (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Ask {plan.company_name ?? 'the show'}&apos;s show manager to renew or choose a plan.
          </p>
        )}
      </div>
      <Link href="/admin/shows" className="inline-block text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to shows
      </Link>
    </main>
  );
}
