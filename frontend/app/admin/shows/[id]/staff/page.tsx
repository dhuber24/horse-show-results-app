import { redirect } from 'next/navigation';

/**
 * Show Staff is not a separate errand. Deciding who runs a show belongs with
 * naming it and setting its dates, so the staff roster is part of setup Step 1
 * and this route is kept only so old links and bookmarks still land somewhere
 * useful.
 */
export default async function ShowStaffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/shows/${id}/edit`);
}
