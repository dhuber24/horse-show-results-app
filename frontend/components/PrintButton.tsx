'use client';

/**
 * Print, for a page that is otherwise entirely server-rendered.
 *
 * "Download" in this app is the browser's print-to-PDF — the same choice the
 * show bill makes. A generated document that the office prints when it needs a
 * copy cannot go stale the way an uploaded one does.
 */
export default function PrintButton({ label = '🖨 Print' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="px-3 py-2 rounded text-sm font-medium border"
      style={{ borderColor: '#d4b896', color: '#8b4513', backgroundColor: '#ffffff' }}
    >
      {label}
    </button>
  );
}
