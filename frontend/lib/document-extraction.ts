/**
 * Shared pieces for reading uploaded horse paperwork.
 *
 * Used by two upload surfaces that behave differently: `HorseDocuments` saves
 * against a horse that already exists, while the add-a-horse wizard stages
 * documents before there is a horse at all. Both show the same review UI, so
 * the labels and helpers live here rather than in either component.
 *
 * See docs/document-extraction.md for the rule these all serve: the model
 * suggests, a human saves.
 */

export interface ExtractionResponse {
  extraction_id: string;
  status: string;
  message: string | null;
  fields: Record<string, unknown>;
  low_confidence_fields: string[];
  notes: string | null;
}

/** Human labels for the fields the review panel reports on. */
export const FIELD_LABELS: Record<string, string> = {
  document_type: 'Document type',
  issue_date: 'Issue date',
  expiry_date: 'Expiry date',
  // Equine identification
  horse_name: 'Horse name',
  age_text: 'Age',
  sex: 'Sex',
  breed: 'Breed',
  color: 'Color',
  microchip_number: 'Microchip',
  markings: 'Markings',
  identity_images_present: 'Identity images',
  // Result
  result: 'Test result',
  test_type: 'Test type',
  test_reason: 'Reason for test',
  // Dates
  test_date: 'Blood drawn',
  date_received: 'Received by lab',
  date_reported: 'Reported by lab',
  // Laboratory and tracking
  accession_number: 'Accession no.',
  lab_name: 'Laboratory',
  technician_name: 'EIA technician',
  // Contacts
  owner_name: 'Owner',
  owner_address: 'Owner address',
  stable_name: 'Stable',
  veterinarian_name: 'Veterinarian',
  veterinarian_clinic: 'Clinic',
  veterinarian_phone: 'Phone',
  clinic_license_number: 'Clinic licence no.',
  // Registration papers
  association_code: 'Association',
  registration_number: 'Registration no.',
  sire_name: 'Sire',
  dam_name: 'Dam',
  foaling_date: 'Foaled',
  breeder: 'Breeder',
};

/**
 * Read-only detail shown alongside the form.
 *
 * Ordered to mirror a Coggins form top-to-bottom — identification, then result,
 * then dates, then lab and contacts — so someone can check the panel against the
 * paper in front of them without hunting. Identity fields come first because
 * that is what verification actually turns on: a valid test attached to the
 * wrong horse is the failure worth catching.
 */
export const DETAIL_FIELDS = [
  'horse_name', 'age_text', 'sex', 'breed', 'color', 'microchip_number', 'markings',
  'identity_images_present',
  'result', 'test_type', 'test_reason',
  'test_date', 'date_received', 'date_reported',
  'accession_number', 'lab_name', 'technician_name',
  'owner_name', 'owner_address', 'stable_name',
  'veterinarian_name', 'veterinarian_clinic', 'veterinarian_phone', 'clinic_license_number',
  'association_code', 'registration_number', 'sire_name', 'dam_name', 'foaling_date', 'breeder',
];

/**
 * Detail fields that hold prose rather than a short value. These get the full
 * row and wrap instead of being truncated — a markings description cut off at
 * "White star on fore..." is worse than useless for identity verification,
 * since it looks like it was checked.
 */
export const WIDE_DETAIL_FIELDS = new Set(['markings', 'owner_address']);

export function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/**
 * Things about the read that the person saving should not be able to miss.
 *
 * A finalized Coggins virtually always reads NEGATIVE — a non-negative sample
 * gets escalated to federal authorities for quarantine rather than issued as a
 * routine certificate. So a form that reads POSITIVE is either a serious
 * finding or a misread, and both cases want a human looking hard rather than
 * the value sitting quietly in a detail list. Same for a missing identity
 * image, which is what these forms use to prove the paperwork matches the
 * horse in front of you.
 */
export function reviewWarnings(fields: Record<string, unknown>): string[] {
  const out: string[] = [];
  const result = asText(fields.result);
  if (result === 'POSITIVE' || result === 'INCONCLUSIVE') {
    out.push(
      `This document reads ${result}. A finalized Coggins is almost always negative — ` +
      `check the document itself before saving, and do not enter the horse on this ` +
      `paperwork without confirming it with the show office.`
    );
  }
  if (asText(fields.identity_images_present) === 'NONE') {
    out.push(
      'No identity photos or marked diagram were found on this form. A Coggins uses ' +
      'those to prove the test belongs to this horse — worth a second look.'
    );
  }
  return out;
}

/**
 * A Coggins rarely prints an expiration — it prints the date blood was drawn,
 * and how long that stays good is state and association policy. So the backend
 * never returns a computed expiry. This offers the common 12-month reading as
 * something the uploader clicks, so a derived date is always a human's call.
 *
 * The 12 months runs from the **blood draw**, not from the date the lab
 * reported the result, so callers pass `test_date` — passing `date_reported`
 * would quietly grant the horse extra days of eligibility it does not have.
 */
export function twelveMonthsAfter(iso: string): string | null {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  // A Feb 29 draw has no anniversary in a common year. Clamp to Feb 28 rather
  // than letting it roll into March: this date decides whether a horse may
  // compete, so when the calendar is ambiguous it should round against extra
  // eligibility, not toward it.
  const lastOfMonth = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  const next = new Date(Date.UTC(y + 1, m - 1, Math.min(d, lastOfMonth)));
  return Number.isNaN(next.getTime()) ? null : next.toISOString().slice(0, 10);
}

/**
 * Read a document. `horseId` is omitted by the add-a-horse wizard, which has no
 * horse yet and uses the unattached endpoint.
 *
 * Returns null on any failure. Reading is a convenience over a form that still
 * works by hand, so a network error here should cost the uploader nothing but
 * the shortcut.
 */
export async function analyzeDocument(
  file: File,
  horseId?: string
): Promise<ExtractionResponse | null> {
  try {
    const fd = new FormData();
    fd.append('file', file);
    const url = horseId ? `/api/horses/${horseId}/documents/analyze` : '/api/documents/analyze';
    const res = await fetch(url, { method: 'POST', body: fd });
    if (!res.ok) return null;
    const json: ExtractionResponse = await res.json();
    return json.status === 'succeeded' ? json : null;
  } catch {
    return null;
  }
}
