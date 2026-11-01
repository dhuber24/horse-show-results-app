/**
 * Photos of the judge's card (migration 177) — the type, the file link, and
 * the shrinking a photo gets before it leaves the phone.
 *
 * Client-safe on purpose: the scribe's photo panel is a client component, so
 * nothing here may import the session. The server fetcher is `fetchCardPhotos`
 * in `lib/api.ts`.
 */

export type CardPhoto = {
  id: string;
  class_id: string;
  /** The `show_judges` assignment whose card this is; null is the unattributed card. */
  judge_id: string | null;
  mime_type: string;
  file_size: number;
  created_at: string | null;
};

type Judge = { id: string; first_name: string; last_name: string };

/**
 * The longest side a card is kept at. A letter-size card at roughly 180 dpi:
 * a judge's handwriting is still readable zoomed in, and the photo is a few
 * hundred KB rather than the camera's several MB.
 */
export const CARD_PHOTO_MAX_EDGE = 2000;

const JPEG_QUALITY = 0.85;

/**
 * The photo itself, through the Next handler (the backend's host is a
 * container name the browser cannot reach). An id always names the same
 * bytes, so the address never needs a version on it.
 */
export function cardPhotoHref(showId: string, classId: string, photoId: string): string {
  return `/api/shows/${showId}/classes/${classId}/card-photos/${photoId}/file`;
}

/** Whose card a photo is, by name — or null for the unattributed card, or a
 *  judge no longer on the panel. */
export function photoJudgeName(photo: CardPhoto, judges: Judge[]): string | null {
  const judge = photo.judge_id ? judges.find((j) => j.id === photo.judge_id) : undefined;
  return judge ? `${judge.first_name} ${judge.last_name}` : null;
}

/** The size to draw a photo at so its longest side is at most `max`. Never
 *  enlarges: a small photo is sent as it is drawn. */
export function fitWithin(
  width: number,
  height: number,
  max: number = CARD_PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * The photo as it is sent: no more than `CARD_PHOTO_MAX_EDGE` on its longest
 * side, saved again as a JPEG.
 *
 * A phone photo is several MB — a long wait on show-grounds signal, and a lot
 * of database for one sheet of paper. Drawing it on a canvas also leaves behind
 * everything the camera wrote into the file, its location first, and bakes in
 * the rotation the camera only noted (the browser applies it when it draws).
 *
 * Falls back to the file as picked when the browser cannot draw it, so a card
 * is never lost to the shrinking; the backend's own limit catches what that
 * lets through.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const image = await loadImage(file);
    const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The browser could not read that photo'));
    };
    image.src = url;
  });
}
