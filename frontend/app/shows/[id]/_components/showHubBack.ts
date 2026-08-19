import { auth } from '@/auth';

/**
 * Where "Back to Show Menu" goes from a show sub-page.
 *
 * There are two show menus, and which one you came from depends on whether you
 * are signed in. `/shows/[id]` is the exhibitor's hub — sign-up, registration,
 * the bill. `/shows/[id]/live` is the at-the-rail hub people reach by QR code
 * with no account, so it offers only schedule, results and leaderboard.
 *
 * Sending everyone to one of them strands the other half: a signed-out
 * spectator lands on a page asking them to register, or an exhibitor loses the
 * menu they were just using. Cheap to ask, so ask.
 */
export async function showHubBack(showId: string): Promise<{
  backHref: string;
  backLabel: string;
}> {
  const session = await auth();
  return {
    backHref: session ? `/shows/${showId}` : `/shows/${showId}/live`,
    backLabel: 'Back to Show Menu',
  };
}
