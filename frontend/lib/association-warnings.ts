/**
 * What the association rules said about entries that were just saved.
 *
 * Nothing refuses an entry over an APHA or AQHA rule any more (2026-10-27):
 * which rules a show holds its exhibitors to is the show company's call. The
 * entry is saved and its issues come back on `association_warnings`, and this
 * is how the screen that saved it says so — the office chases them from the
 * show's readiness panel.
 */

export type AssociationWarning = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  class_id?: string | null;
};

export type SavedEntry = {
  class_id: string;
  association_warnings?: AssociationWarning[];
};

/**
 * One line per issue, named by its class, the ones the association would not
 * accept first. The same message twice for one class is said once.
 */
export function warningLines(
  entries: SavedEntry[],
  classLabel: (classId: string) => string,
): string[] {
  const seen = new Set<string>();
  const lines: { severity: AssociationWarning['severity']; text: string }[] = [];
  for (const entry of entries) {
    for (const warning of entry.association_warnings ?? []) {
      const text = `${classLabel(entry.class_id)}: ${warning.message}`;
      if (seen.has(text)) continue;
      seen.add(text);
      lines.push({ severity: warning.severity, text });
    }
  }
  return [
    ...lines.filter((l) => l.severity === 'error'),
    ...lines.filter((l) => l.severity !== 'error'),
  ].map((l) => l.text);
}
