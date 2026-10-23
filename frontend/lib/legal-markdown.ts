/**
 * The Terms of Service and Privacy Policy (`/terms`, `/privacy`): the little
 * Markdown they are written in, turned into blocks the page renders.
 *
 * Both are drafted and edited as Claude Docs, and a doc exports as Markdown —
 * so the text in `lib/legal/` is that export, drafting note removed, and a
 * change to the wording is a paste, not a rewrite into JSX. Only what the two
 * documents use is understood: `#` and `##` headings, paragraphs, `- ` lists,
 * pipe tables, and `**bold**` and `[label](href)` inside any of them. Anything
 * else stays as its literal text, which is visible on the page rather than
 * silently dropped.
 */

export interface LegalInline {
  text: string;
  bold?: boolean;
  href?: string;
}

export type LegalBlock =
  | { kind: 'part'; text: string }
  | { kind: 'section'; text: string; id: string }
  | { kind: 'paragraph'; inline: LegalInline[] }
  | { kind: 'list'; items: LegalInline[][] }
  | { kind: 'table'; header: LegalInline[][]; rows: LegalInline[][][] };

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** One line of text split into plain runs, bold runs and links. A Docs export
 *  escapes a literal `[` and `_` with a backslash; the escape is dropped. */
export function legalInline(text: string): LegalInline[] {
  const runs: LegalInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) runs.push({ text: unescape(text.slice(last, at)) });
    if (match[1] !== undefined) runs.push({ text: unescape(match[1]), bold: true });
    else runs.push({ text: unescape(match[2]), href: match[3] });
    last = at + match[0].length;
  }
  if (last < text.length) runs.push({ text: unescape(text.slice(last)) });
  return runs;
}

function unescape(text: string): string {
  return text.replace(/\\([[\]_*])/g, '$1');
}

/** `6. Plans for Show Companies` → `6-plans-for-show-companies`, so a section
 *  can be linked as `/terms#7-fees-invoicing-and-payment`. */
export function legalSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

const TABLE_RULE = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;

export function parseLegalMarkdown(markdown: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === '') {
      i += 1;
    } else if (line.startsWith('## ')) {
      const text = line.slice(3).trim();
      blocks.push({ kind: 'section', text, id: legalSlug(text) });
      i += 1;
    } else if (line.startsWith('# ')) {
      blocks.push({ kind: 'part', text: line.slice(2).trim() });
      i += 1;
    } else if (line.startsWith('- ')) {
      const items: LegalInline[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        items.push(legalInline(lines[i].trim().slice(2)));
        i += 1;
      }
      blocks.push({ kind: 'list', items });
    } else if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!TABLE_RULE.test(lines[i].trim())) rows.push(tableCells(lines[i]));
        i += 1;
      }
      const [header = [], ...body] = rows;
      blocks.push({
        kind: 'table',
        header: header.map(legalInline),
        rows: body.map((row) => row.map(legalInline)),
      });
    } else {
      // A paragraph runs until a blank line or the start of another block.
      const parts: string[] = [];
      while (i < lines.length) {
        const next = lines[i].trim();
        if (next === '' || next.startsWith('#') || next.startsWith('- ') || next.startsWith('|')) break;
        parts.push(next);
        i += 1;
      }
      blocks.push({ kind: 'paragraph', inline: legalInline(parts.join(' ')) });
    }
  }

  return blocks;
}
