/**
 * Where "Sign up" goes for a show, by the show's status and its sign-up deadline.
 *
 * Every show the public can see carries one, because the question somebody is
 * asking when they find a show in a list is "can I enter this?", and making
 * them open the show to find out is one step too many.
 *
 *   * **PUBLISHED, sign-up open** — the registration flow. A signed-out visitor
 *     is sent to sign in first and brought back (`/shows/[id]/register`
 *     redirects with `?next=`), and the sign-in page offers account creation
 *     with the same return path.
 *   * **PUBLISHED past its last day to sign up online** (migration 159), or
 *     **ACTIVE** — online sign-up has closed, but the office often still takes
 *     a late entry at the desk. So the link is to the show's contact form, which
 *     opens with the subject filled in and a line saying why they are there,
 *     rather than a dead button.
 *   * Anything else — a finished show — has nothing to sign up for.
 *
 * `signupOpen` is `signup_open` off the show payload (`self_entry.signup_open`),
 * decided on the server so a list and the form it links to cannot disagree about
 * the day. Omitted, a published show counts as open.
 */
export type SignUpLink = { href: string; label: string; hint: string };

export const ENTERING_TOPIC = 'entering';

export function signUpLink(
  showId: string,
  status: string,
  signupOpen: boolean = true,
): SignUpLink | null {
  if (status === 'PUBLISHED' && signupOpen) {
    return {
      href: `/shows/${showId}/register`,
      label: 'Sign up for this show',
      // "Any": a show that sells no stalls, shavings or camping has no stalls
      // step, and this is read before anybody knows which kind of show it is.
      hint: 'Profile, horses and any stalls, then classes.',
    };
  }
  if (status === 'PUBLISHED' || status === 'ACTIVE') {
    return {
      href: `/shows/${showId}/contact?about=${ENTERING_TOPIC}`,
      label: 'Sign up — message the show office',
      hint:
        status === 'ACTIVE'
          ? 'This show is under way. Ask the office whether they are still taking entries.'
          : 'Online sign-up has closed. Ask the office whether they are still taking entries.',
    };
  }
  return null;
}
