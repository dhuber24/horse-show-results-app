/**
 * Where "Back to Show Menu" goes from a show's sub-pages: the show's own main
 * page, `/shows/[id]`, for everyone.
 *
 * It used to depend on who was asking. Signed in went to `/shows/[id]`, signed
 * out to `/shows/[id]/live`, and Results and the Leaderboard sent everybody to
 * `/live` — so an exhibitor who opened Results from their show menu was
 * returned to a different menu, and a visitor who opened the show bill from
 * the show's page was returned somewhere they had never been. There is one main
 * page per show now, and one menu on it for everybody, signed in or not
 * (`ShowHub`), so nobody arrives there stranded. `/live` renders the same menu.
 */
export function showHubBack(showId: string): { backHref: string; backLabel: string } {
  return { backHref: `/shows/${showId}`, backLabel: 'Back to Show Menu' };
}
