/**
 * A show's stall map and RV / camping map (migration 182): files in
 * `show_documents`, uploaded on the Lodging setup step and opened by exhibitors
 * from Show Details. One of each per show; uploading again replaces it.
 */
export type MapKind = 'stall' | 'rv';

export type ShowMapDocument = {
  id: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

export type ShowMaps = Record<MapKind, ShowMapDocument | null>;

export const NO_MAPS: ShowMaps = { stall: null, rv: null };

export const MAP_KINDS: readonly { kind: MapKind; label: string }[] = [
  { kind: 'stall', label: 'Stall map' },
  { kind: 'rv', label: 'RV / camping map' },
];

/** Where the browser opens a map — the public passthrough route. */
export function mapFileHref(showId: string, kind: MapKind): string {
  return `/api/shows/${showId}/maps/${kind}/file`;
}
