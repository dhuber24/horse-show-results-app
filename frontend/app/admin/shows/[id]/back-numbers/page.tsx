import { redirect } from 'next/navigation';

/**
 * Folded into the registration desk, where a back number is assigned in the
 * same breath as the entries it belongs to. See `desk/page.tsx`.
 *
 * The per-class sheet at `classes/[classId]/back-numbers` is a different tool
 * and is untouched.
 */
export default async function BackNumbersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/shows/${id}/desk`);
}
