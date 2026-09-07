import { redirect } from 'next/navigation';

/**
 * Sanctioned Classes moved into setup Step 6.
 *
 * It was its own screen, hanging off the class list, while the clubs were
 * picked in one step and priced in a box on another — three screens for one
 * decision, none of which charges anybody on its own. Step 6 asks all three in
 * the order the answers come.
 *
 * A redirect rather than a deletion, the same as `/entries` and `/back-numbers`
 * onto the desk: this path is in show managers' bookmarks and in a season of
 * links, and landing on a 404 is not how somebody learns the screen moved.
 */
export default async function ClassSanctioningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/shows/${id}/setup/sanctioning`);
}
