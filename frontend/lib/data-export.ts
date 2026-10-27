/**
 * The show's results as data, in the columns the office picks
 * (`backend/data_export.py`).
 *
 * The backend sends every column and every row; the page keeps the ones ticked.
 * So the preview and the file are one snapshot, and changing the selection
 * costs no request.
 */

export type DataExportKind = 'placings' | 'entries';

export type DataExportValue = string | number | null;

export type DataExportRow = Record<string, DataExportValue>;

export type DataExportField = {
  key: string;
  label: string;
  group: string;
  kinds: DataExportKind[];
  /** Ticked until the office says otherwise. */
  default: boolean;
};

export type DataExportGroup = { key: string; label: string };

export type DataExport = {
  show_id: string;
  show_name: string;
  generated_at: string;
  groups: DataExportGroup[];
  fields: DataExportField[];
  placings: DataExportRow[];
  entries: DataExportRow[];
  notes: string[];
};

/** What was ticked, and every column the office has been offered. */
export type SavedSelection = { selected: string[]; seen: string[] };

export function fieldsFor(data: DataExport, kind: DataExportKind): DataExportField[] {
  return data.fields.filter((f) => f.kinds.includes(kind));
}

/**
 * The columns to start with: the office's own choice for every column it has
 * been offered before, and the backend's suggestion for the rest.
 *
 * `seen` is what keeps a new column from vanishing. Remembering only what was
 * ticked would leave an NSBA column off at the first show that has one, because
 * nobody could have ticked it at a show that did not.
 */
export function startingSelection(
  fields: DataExportField[],
  saved: SavedSelection | null,
): Set<string> {
  const seen = new Set(saved?.seen ?? []);
  const selected = new Set(saved?.selected ?? []);
  return new Set(
    fields
      .filter((f) => (seen.has(f.key) ? selected.has(f.key) : f.default))
      .map((f) => f.key),
  );
}

/** The selection to remember, merged into what was remembered before so the
 *  columns of one kind of show are not forgotten at another. */
export function selectionToSave(
  fields: DataExportField[],
  selected: Set<string>,
  saved: SavedSelection | null,
): SavedSelection {
  const offered = new Set(fields.map((f) => f.key));
  const keep = (saved?.selected ?? []).filter((key) => !offered.has(key));
  return {
    selected: [...keep, ...fields.filter((f) => selected.has(f.key)).map((f) => f.key)],
    seen: [...new Set([...(saved?.seen ?? []), ...offered])],
  };
}

/** How many rows have something in each column. */
export function filledCounts(fields: DataExportField[], rows: DataExportRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of fields) counts[f.key] = 0;
  for (const row of rows) {
    for (const f of fields) {
      const value = row[f.key];
      if (value !== null && value !== undefined && value !== '') counts[f.key] += 1;
    }
  }
  return counts;
}

function escape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The file: a header row and the rows, nothing above them.
 *
 * Unlike a report's CSV (`ReportActions`) there is no title line. This file's
 * job is to be stacked with other shows' and read by a spreadsheet or another
 * system, and a line above the header breaks both. The show is a column for
 * whoever wants it.
 */
export function toDataCsv(columns: DataExportField[], rows: DataExportRow[]): string {
  const lines = [columns.map((c) => escape(c.label)).join(',')];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const value = row[c.key];
          return value === null || value === undefined ? '' : escape(String(value));
        })
        .join(','),
    );
  }
  return lines.join('\r\n');
}
