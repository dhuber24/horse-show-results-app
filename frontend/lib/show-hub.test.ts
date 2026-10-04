// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';

import type { MyShowStanding } from './my-shows';
import { buildShowHub, publicSections, type HubShow, type HubViewer } from './show-hub';

const SHOW_ID = 's1';
const REGISTER = `/shows/${SHOW_ID}/register`;
const ASK_THE_OFFICE = `/shows/${SHOW_ID}/contact?about=entering`;

const OPEN: HubShow = { status: 'PUBLISHED', signup_open: true, entry_deadline: '2026-10-01' };
const PAST_DEADLINE: HubShow = { status: 'PUBLISHED', signup_open: false, entry_deadline: '2026-10-01' };
const ACTIVE: HubShow = { status: 'ACTIVE', signup_open: false };
const COMPLETED: HubShow = { status: 'COMPLETED', signup_open: false };
const EVERY_STATE = [OPEN, PAST_DEADLINE, ACTIVE, COMPLETED];

function standing(overrides: Partial<MyShowStanding> = {}): MyShowStanding {
  return {
    show_id: SHOW_ID,
    signed_up: false,
    registered_at: null,
    cancelled_at: null,
    cancellation: null,
    back_number: null,
    entry_count: 0,
    arrival_date: null,
    departure_date: null,
    waivers_outstanding: 0,
    offers_lodging: true,
    ...overrides,
  };
}

const visitor: HubViewer = { signedIn: false, canSelfRegister: false, standing: null };
const staff: HubViewer = { signedIn: true, canSelfRegister: false, standing: null };
const exhibitor = (s: Partial<MyShowStanding> = {}): HubViewer => ({
  signedIn: true,
  canSelfRegister: true,
  standing: standing(s),
});

const mine = (show: HubShow, viewer: HubViewer) =>
  buildShowHub(SHOW_ID, show, viewer).mine.map((tile) => tile.title);

const SECTIONS = ['Class Schedule', 'Patterns', 'Results', 'Leaderboard', 'Show Bill', 'Show Details'];

describe('the show’s sections', () => {
  it('are the same six, in the hub’s order', () => {
    expect(publicSections(SHOW_ID).map((tile) => tile.title)).toEqual(SECTIONS);
    expect(publicSections(SHOW_ID).map((tile) => tile.href)).toEqual([
      '/shows/s1/schedule',
      '/shows/s1/patterns',
      '/shows/s1/results',
      '/shows/s1/leaderboard',
      '/shows/s1/showbill',
      '/shows/s1/details',
    ]);
  });

  it('are the same block for every reader, whatever the show’s status, then the show office', () => {
    const readers = [visitor, staff, exhibitor(), exhibitor({ signed_up: true, entry_count: 4 })];
    for (const show of EVERY_STATE) {
      const blocks = readers.map((viewer) => buildShowHub(SHOW_ID, show, viewer).sections);
      expect(blocks[0].map((tile) => tile.title)).toEqual([...SECTIONS, 'Message the Show Office']);
      for (const block of blocks) expect(block).toEqual(blocks[0]);
    }
  });

  it('go back to the list the show is found on', () => {
    expect(buildShowHub(SHOW_ID, ACTIVE, visitor).back).toEqual({ href: '/shows/active', label: 'Back to Active Shows' });
    for (const show of [OPEN, PAST_DEADLINE, COMPLETED]) {
      expect(buildShowHub(SHOW_ID, show, visitor).back).toEqual({ href: '/', label: 'Back to Shows' });
    }
  });
});

describe('the sign-up bar, for everybody who isn’t an exhibitor', () => {
  it('is the registration flow while sign-up is open, with its last day', () => {
    const { signUp, statusBanner, mine: theirs } = buildShowHub(SHOW_ID, OPEN, visitor);
    expect(statusBanner).toBe(false);
    expect(theirs).toEqual([]);
    expect(signUp?.href).toBe(REGISTER);
    expect(signUp?.hint).toBe('Profile, horses and any stalls, then classes. Sign up online by Thu, Oct 1.');
  });

  it('goes to the show office past the last day, and while the show runs', () => {
    expect(buildShowHub(SHOW_ID, PAST_DEADLINE, visitor).signUp?.href).toBe(ASK_THE_OFFICE);
    expect(buildShowHub(SHOW_ID, ACTIVE, visitor).signUp?.href).toBe(ASK_THE_OFFICE);
  });

  it('has nothing to offer once the show is over', () => {
    expect(buildShowHub(SHOW_ID, COMPLETED, visitor).signUp).toBeNull();
  });

  it('is the same signed in with no exhibitor record — the office sees what the public sees', () => {
    for (const show of EVERY_STATE) {
      expect(buildShowHub(SHOW_ID, show, staff)).toEqual(buildShowHub(SHOW_ID, show, visitor));
    }
  });

  it('reads no standing for somebody with no exhibitor record, whatever came back', () => {
    const hub = buildShowHub(SHOW_ID, OPEN, { ...staff, standing: standing({ signed_up: true, entry_count: 3 }) });
    expect(hub).toEqual(buildShowHub(SHOW_ID, OPEN, visitor));
  });
});

describe('an exhibitor', () => {
  it('not yet in sees the same page as a visitor', () => {
    for (const show of EVERY_STATE) {
      expect(buildShowHub(SHOW_ID, show, exhibitor())).toEqual(buildShowHub(SHOW_ID, show, visitor));
    }
  });

  it('signed up gets their own tiles and no sign-up bar', () => {
    const hub = buildShowHub(SHOW_ID, OPEN, exhibitor({ signed_up: true, entry_count: 2 }));
    expect(hub.statusBanner).toBe(true);
    expect(hub.signUp).toBeNull();
    expect(hub.mine.map((tile) => tile.title)).toEqual(['Add/Drop Classes', 'My Registration', 'What I Owe']);
  });

  it('is not promised stalls on their own tiles at a show that sells none', () => {
    const [, registration, bill] = buildShowHub(SHOW_ID, OPEN, exhibitor({ signed_up: true, offers_lodging: false })).mine;
    expect(registration.description).not.toMatch(/stalls/);
    expect(bill.description).not.toMatch(/stalls/);
  });

  it('signed up keeps the class tile in its slot once the show runs', () => {
    expect(mine(ACTIVE, exhibitor({ signed_up: true }))).toEqual(['Add/Drop Classes', 'What I Owe']);
    expect(mine({ ...ACTIVE, self_entry_closes: 'show_start' }, exhibitor({ signed_up: true }))).toEqual([
      'My Classes',
      'What I Owe',
    ]);
  });

  it('keeps What I Owe after the show — the bill outlives it', () => {
    expect(mine(COMPLETED, exhibitor({ signed_up: true }))).toEqual(['What I Owe']);
  });

  it('cancelled hears it from the banner, which carries the way back in while sign-up is open', () => {
    const cancelled = { cancelled_at: '2026-09-20T12:00:00Z' };
    expect(buildShowHub(SHOW_ID, OPEN, exhibitor(cancelled))).toMatchObject({ statusBanner: true, signUp: null, mine: [] });
    expect(buildShowHub(SHOW_ID, PAST_DEADLINE, exhibitor(cancelled)).signUp?.href).toBe(ASK_THE_OFFICE);
    expect(buildShowHub(SHOW_ID, ACTIVE, exhibitor(cancelled)).signUp?.href).toBe(ASK_THE_OFFICE);
  });

  it('entered by the office is in: the banner finishes the sign-up, and the bar stays away once it runs', () => {
    const entered = { entry_count: 2 };
    const open = buildShowHub(SHOW_ID, OPEN, exhibitor(entered));
    expect(open).toMatchObject({ statusBanner: true, signUp: null });
    expect(open.mine.map((tile) => tile.title)).toEqual(['What I Owe']);
    expect(buildShowHub(SHOW_ID, PAST_DEADLINE, exhibitor(entered)).signUp?.href).toBe(ASK_THE_OFFICE);
    expect(buildShowHub(SHOW_ID, ACTIVE, exhibitor(entered)).signUp).toBeNull();
  });
});
