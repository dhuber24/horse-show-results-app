import Link from 'next/link';
import { parseLegalMarkdown, type LegalBlock, type LegalInline } from '@/lib/legal-markdown';

/**
 * A legal page (`/terms`, `/privacy`): its title, effective date and text.
 *
 * The text is Markdown from `lib/legal/` (see `lib/legal-markdown.ts`).
 * Headings step down one level when the document has no `#` parts, so the
 * Privacy Policy's sections are `h2`s under the page title rather than
 * skipping a level. Every section heading carries its anchor, so a reader can
 * be sent to `/terms#7-fees-invoicing-and-payment`.
 */
export default function LegalDocument({
  title,
  effective,
  markdown,
}: {
  title: string;
  effective: string;
  markdown: string;
}) {
  const blocks = parseLegalMarkdown(markdown);
  const hasParts = blocks.some((block) => block.kind === 'part');

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to Home
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{title}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Effective {effective}</p>
      </div>

      <div className="text-sm leading-relaxed space-y-3" style={{ color: 'var(--text-deep)' }}>
        {blocks.map((block, i) => (
          <Block key={i} block={block} hasParts={hasParts} />
        ))}
      </div>
    </main>
  );
}

function Block({ block, hasParts }: { block: LegalBlock; hasParts: boolean }) {
  switch (block.kind) {
    case 'part':
      return (
        <h2
          className="text-xl font-bold pt-6 mt-6 border-t first:mt-0 first:pt-0 first:border-t-0"
          style={{ color: 'var(--foreground)', borderColor: 'var(--border)' }}
        >
          {block.text}
        </h2>
      );
    case 'section': {
      const Heading = hasParts ? 'h3' : 'h2';
      return (
        <Heading id={block.id} className="text-base font-semibold pt-4 scroll-mt-20" style={{ color: 'var(--foreground)' }}>
          {block.text}
        </Heading>
      );
    }
    case 'paragraph':
      return (
        <p>
          <Inline runs={block.inline} />
        </p>
      );
    case 'list':
      return (
        <ul className="list-disc pl-5 space-y-1">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline runs={item} />
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-left text-sm">
            <thead style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} className="px-3 py-2 font-semibold align-top" style={{ color: 'var(--foreground)' }}>
                    <Inline runs={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  {row.map((cell, c) => (
                    <td key={c} className="px-3 py-2 align-top">
                      <Inline runs={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function Inline({ runs }: { runs: LegalInline[] }) {
  return (
    <>
      {runs.map((run, i) => {
        if (run.href?.startsWith('/')) {
          return (
            <Link key={i} href={run.href} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              {run.text}
            </Link>
          );
        }
        if (run.href) {
          return (
            <a
              key={i}
              href={run.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              {run.text}
            </a>
          );
        }
        if (run.bold) {
          return (
            <strong key={i} style={{ color: 'var(--foreground)' }}>
              {run.text}
            </strong>
          );
        }
        return <span key={i}>{run.text}</span>;
      })}
    </>
  );
}
