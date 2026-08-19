import { redirect } from 'next/navigation';

/**
 * Paperwork was setup Step 7. What a show requires of an exhibitor is answered
 * during registration, not while the show is being built, so it moved to the
 * registration desk. This route is kept so old links still land on it.
 */
export default async function SetupPaperworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/shows/${id}/desk/paperwork`);
}
