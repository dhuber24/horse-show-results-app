/**
 * The rules every screen showing a judge's-card photo has to agree on, and the
 * size a photo is shrunk to before it is sent.
 */
import { describe, expect, it } from '@jest/globals';

import { CARD_PHOTO_MAX_EDGE, cardPhotoHref, fitWithin, photoJudgeName, type CardPhoto } from './card-photos';

function photo(judgeId: string | null): CardPhoto {
  return {
    id: 'p1',
    class_id: 'c1',
    judge_id: judgeId,
    mime_type: 'image/jpeg',
    file_size: 300_000,
    created_at: null,
  };
}

const JUDGES = [
  { id: 'j1', first_name: 'Ann', last_name: 'Reed' },
  { id: 'j2', first_name: 'Bo', last_name: 'Hale' },
];

describe('fitWithin', () => {
  it('brings a phone photo down to the longest side kept', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: CARD_PHOTO_MAX_EDGE, height: 1500 });
  });

  it('keeps a portrait photo the right way up', () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: CARD_PHOTO_MAX_EDGE });
  });

  it('never enlarges a photo already small enough', () => {
    expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(CARD_PHOTO_MAX_EDGE, 10)).toEqual({ width: CARD_PHOTO_MAX_EDGE, height: 10 });
  });
});

describe('photoJudgeName', () => {
  it('names the judge whose card it is', () => {
    expect(photoJudgeName(photo('j2'), JUDGES)).toBe('Bo Hale');
  });

  it('names nobody for the unattributed card or a judge off the panel', () => {
    expect(photoJudgeName(photo(null), JUDGES)).toBeNull();
    expect(photoJudgeName(photo('gone'), JUDGES)).toBeNull();
  });
});

describe('cardPhotoHref', () => {
  it('goes through the Next handler, which the browser can reach', () => {
    expect(cardPhotoHref('s1', 'c1', 'p1')).toBe('/api/shows/s1/classes/c1/card-photos/p1/file');
  });
});
