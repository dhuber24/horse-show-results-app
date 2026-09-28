/**
 * Where "Sign up" goes for a show, by the show's status.
 *
 * Every show the public can see carries one, because the question somebody is
 * asking when they find a show in a list is "can I enter this?", and making
 * them open the show to find out is one step too many.
 *
 *   * **PUBLISHED** — the registration flow. A signed-out visitor is sent to
 *     sign in first and brought back (`/shows/[id]/register` redirects with
 *     `?next=`), and the sign-in page offers account creation with the same
 *     return path.
 *   * **ACTIVE** — the show is under way and online sign-up has closed, but
 *     the office often still takes a late entry at the counter. So the link is
 *     to the show's contact form, which opens with the subject filled in and a
 *     line saying why they are there, rather than a dead button.
 *   * Anything else — a finished show — has nothing to sign up for.
 */
export type SignUpLink = { href: string; label: string; hint: string };

export const ENTERING_TOPIC = 'entering';

export function signUpLink(showId: string, status: string): SignUpLink | null {
  if (status === 'PUBLISHED') {
    return {
      href: `/shows/${showId}/register`,
      label: 'Sign up for this show',
      hint: 'Profile, stalls, then classes.',
    };
  }
  if (status === 'ACTIVE') {
    return {
      href: `/shows/${showId}/contact?about=${ENTERING_TOPIC}`,
      label: 'Sign up — message the show office',
      hint: 'This show is under way. Ask the office whether they are still taking entries.',
    };
  }
  return null;
}
