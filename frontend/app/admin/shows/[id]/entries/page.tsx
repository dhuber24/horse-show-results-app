import { redirect } from 'next/navigation';

/**
 * Folded into the registration desk.
 *
 * Entering someone in a class, giving them a back number, and checking their
 * papers are one conversation at the counter; this used to be the first third
 * of it. Kept as a redirect rather than deleted because the route is bookmarked
 * and linked from staff notes.
 */
export default async function ShowEntriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/shows/${id}/desk`);
}
