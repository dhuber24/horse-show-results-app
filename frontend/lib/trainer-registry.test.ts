// Globals are imported rather than declared ambiently: see api-error.test.ts.
import { describe, expect, it } from '@jest/globals';

import {
  affiliationLabel,
  distanceLabel,
  filterListings,
  initials,
  listingLocation,
  listingProblem,
  mailtoHref,
  planFeatures,
  proPlanLabel,
  registryDisciplines,
  registryStates,
  safeWebUrl,
  socialUrl,
  telHref,
  videoLabel,
  type TrainerListing,
} from './trainer-registry';

function listing(overrides: Partial<TrainerListing> = {}): TrainerListing {
  return {
    id: 'a',
    first_name: 'Jane',
    last_name: 'Smith',
    name: 'Jane Smith',
    business_name: 'Smith Performance Horses',
    city: 'Ocala',
    state: 'FL',
    country: 'US',
    disciplines: ['Reining', 'Ranch Riding'],
    tier: 'pro',
    distance_miles: 12.4,
    bio: 'Started colts for twenty years.',
    website: null,
    public_phone: null,
    public_email: null,
    social_facebook: null,
    social_instagram: null,
    social_tiktok: null,
    headshot_id: null,
    logo_id: null,
    photo_ids: [],
    video_urls: [],
    rate_sheet: [],
    can_contact: true,
    safesport_current: false,
    background_check_current: false,
    has_liability_insurance: false,
    affiliations: [{ id: 'r1', association_code: 'AQHA', association_name: 'American Quarter Horse Association', status: 'professional' }],
    ...overrides,
  };
}

const jane = listing();
const bob = listing({
  id: 'b',
  first_name: 'Bob',
  last_name: 'Jones',
  name: 'Bob Jones',
  business_name: 'Jones Paints',
  city: 'Pilot Point',
  state: 'TX',
  tier: 'basic',
  distance_miles: null,
  disciplines: ['Western Pleasure'],
  bio: null,
  affiliations: [],
});
const none = { query: '', state: '', discipline: '' };

describe('the plans', () => {
  const features = planFeatures();

  // Pro is Basic and more: a row Basic has and Pro lacks would be a downgrade.
  it('gives Pro everything Basic has', () => {
    for (const row of features) {
      if (row.basic) expect(row.pro).toBeTruthy();
    }
  });

  it('leaves Basic most of the table to earn', () => {
    expect(features.filter((row) => !row.basic).length).toBeGreaterThan(features.length / 2);
  });

  it('says the photo and video limits the backend holds', () => {
    const labels = planFeatures({ max_photos: 6, max_video_links: 3 }).map((r) => String(r.pro));
    expect(labels).toContain('Up to 6');
    expect(labels).toContain('Up to 3');
  });

  it('prices Pro by the month and by the year', () => {
    expect(proPlanLabel('monthly')).toBe('$10 / month');
    expect(proPlanLabel('annual')).toBe('$100 / year');
  });
});

describe('what a listing needs', () => {
  const complete = { city: 'Ocala', state: 'FL', zip_code: '34470', disciplines: ['Reining'] };

  it('accepts a town, state, zip and discipline', () => {
    expect(listingProblem(complete)).toBeNull();
    expect(listingProblem({ ...complete, zip_code: '34470-1234' })).toBeNull();
  });

  it('says what is missing, the way the backend does', () => {
    expect(listingProblem({ ...complete, city: ' ' })).toMatch(/town and state/);
    expect(listingProblem({ ...complete, zip_code: '3447' })).toMatch(/zip code/);
    expect(listingProblem({ ...complete, disciplines: [] })).toMatch(/discipline/);
  });
});

describe('filterListings', () => {
  it('keeps the order it was given — the backend ranked it', () => {
    expect(filterListings([bob, jane], none)).toEqual([bob, jane]);
  });

  it('needs every word typed, wherever it appears', () => {
    expect(filterListings([jane, bob], { ...none, query: 'reining ocala' })).toEqual([jane]);
    expect(filterListings([jane, bob], { ...none, query: 'reining texas' })).toEqual([]);
  });

  it('matches the business, a discipline and an association, ignoring case', () => {
    expect(filterListings([jane, bob], { ...none, query: 'JONES paints' })).toEqual([bob]);
    expect(filterListings([jane, bob], { ...none, query: 'western pleasure' })).toEqual([bob]);
    expect(filterListings([jane, bob], { ...none, query: 'quarter horse' })).toEqual([jane]);
  });

  it('narrows by state and by discipline', () => {
    expect(filterListings([jane, bob], { ...none, state: 'TX' })).toEqual([bob]);
    expect(filterListings([jane, bob], { ...none, discipline: 'Reining' })).toEqual([jane]);
  });
});

describe('the filter choices', () => {
  it('offers each state and discipline once, sorted', () => {
    expect(registryStates([bob, jane, jane])).toEqual(['FL', 'TX']);
    expect(registryDisciplines([jane, bob])).toEqual(['Ranch Riding', 'Reining', 'Western Pleasure']);
  });
});

describe('what a listing reads', () => {
  it('labels an affiliation by its card', () => {
    expect(affiliationLabel(jane.affiliations[0])).toBe('AQHA Professional');
  });

  it('gives the town and state, and the country only outside the US', () => {
    expect(listingLocation(jane)).toBe('Ocala, FL');
    expect(listingLocation({ city: 'Calgary', state: 'AB', country: 'CA' })).toBe('Calgary, AB, CA');
    expect(listingLocation({ city: null, state: null, country: 'US' })).toBe('');
  });

  it('rounds a distance to the mile', () => {
    expect(distanceLabel(12.4)).toBe('12 mi away');
    expect(distanceLabel(0.3)).toBe('Under a mile away');
    expect(distanceLabel(null)).toBeNull();
  });

  it('uses initials in place of a photo', () => {
    expect(initials(jane)).toBe('JS');
  });

  it('names where a video is hosted', () => {
    expect(videoLabel('https://www.youtube.com/watch?v=abc')).toBe('YouTube');
    expect(videoLabel('https://youtu.be/abc')).toBe('YouTube');
    expect(videoLabel('https://vimeo.com/123')).toBe('Vimeo');
    expect(videoLabel('https://videos.smithhorses.com/a')).toBe('videos.smithhorses.com');
  });
});

// Everything below was typed by a trainer and is shown to the public, so the
// one thing these must never do is hand back a link that runs script.
describe('links', () => {
  it('follows only web addresses', () => {
    expect(safeWebUrl('https://smithhorses.com')).toBe('https://smithhorses.com/');
    expect(safeWebUrl('smithhorses.com')).toBe('https://smithhorses.com/');
    expect(safeWebUrl('javascript:alert(1)')).toBeNull();
    expect(safeWebUrl('data:text/html,hi')).toBeNull();
    expect(safeWebUrl('not a site')).toBeNull();
    expect(safeWebUrl('')).toBeNull();
  });

  it('turns a handle or a profile URL into a profile link', () => {
    expect(socialUrl('instagram', '@smithhorses')).toBe('https://www.instagram.com/smithhorses');
    expect(socialUrl('tiktok', 'smithhorses')).toBe('https://www.tiktok.com/@smithhorses');
    expect(socialUrl('facebook', 'facebook.com/smithhorses')).toBe('https://facebook.com/smithhorses');
    expect(socialUrl('instagram', 'javascript:alert(1)')).toBeNull();
    expect(socialUrl('instagram', 'two words')).toBeNull();
  });

  it('dials and mails only what looks like a number or an address', () => {
    expect(telHref('(555) 987-6543')).toBe('tel:5559876543');
    expect(telHref('+1 555 987 6543')).toBe('tel:+15559876543');
    expect(telHref('call me')).toBeNull();
    expect(mailtoHref('barn@example.com')).toBe('mailto:barn@example.com');
    expect(mailtoHref('"><script>@x.com')).toBeNull();
  });
});
