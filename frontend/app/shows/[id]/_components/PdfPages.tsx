'use client';

/**
 * A PDF drawn straight into the page: every page one under another at the
 * full width of the column and its own height, with nothing around them.
 *
 * Not an <iframe>, because an iframe hands the file to the browser's own PDF
 * viewer, and that brings its toolbar, thumbnail sidebar, zoom, grey margin and
 * a scroll bar inside the page — none of which the show bill page wants, since
 * it has its own Download button. Many phone browsers will not draw a PDF in
 * an iframe at all. pdf.js renders each page to a canvas instead, so it reads
 * like a picture of the bill.
 *
 * pdf.js is imported inside the effect: it touches browser-only globals at
 * load, so it must never be evaluated on the server, and only this page pays
 * for it.
 */

import { useEffect, useRef, useState } from 'react';

/** Rendered pixel width per page: the column's width at the screen's density,
 *  never below what prints sharply, never a canvas big enough to hurt a phone. */
function renderWidth(cssWidth: number): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(Math.max(cssWidth, 800) * dpr, 4096);
}

export default function PdfPages({ src, title }: { src: string; title: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let cancelled = false;
    let destroy: (() => Promise<void>) | null = null;
    setState('loading');

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        if (cancelled) return;

        const task = pdfjs.getDocument({ url: src });
        destroy = () => task.destroy();
        const doc = await task.promise;
        const width = renderWidth(el.clientWidth);

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.display = 'block';
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          if (n > 1) canvas.style.borderTop = '1px solid var(--border)';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute(
            'aria-label',
            doc.numPages > 1 ? `${title}, page ${n} of ${doc.numPages}` : title,
          );
          el.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
          // Show the first page as soon as it is drawn rather than after the last.
          if (n === 1 && !cancelled) setState('ready');
        }
      } catch {
        if (!cancelled) setState('failed');
      }
    })();

    return () => {
      cancelled = true;
      void destroy?.();
      el.replaceChildren();
    };
  }, [src, title]);

  return (
    <>
      {state === 'loading' && (
        <p className="text-sm p-6 text-center" style={{ color: 'var(--muted)' }}>
          Loading the show bill…
        </p>
      )}
      {state === 'failed' && (
        <p className="text-sm p-6 text-center" style={{ color: 'var(--muted)' }}>
          This show bill can&rsquo;t be shown here. Use Download show bill above to open it.
        </p>
      )}
      <div ref={holder} />
    </>
  );
}
