import { redirect } from 'next/navigation';

/**
 * Folded into the registration desk. The paperwork sweep is now the Paperwork
 * section of each exhibitor's panel, plus a "Paperwork to check" filter on the
 * roster for working the sweep front to back. See `desk/page.tsx`.
 */
export default async function ShowCheckInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/shows/${id}/desk`);
}
