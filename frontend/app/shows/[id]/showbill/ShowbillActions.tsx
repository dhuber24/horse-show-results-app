'use client';

import { useState } from 'react';
import type { ShowbillClassRow } from '../_components/ShowbillDocument';

/**
 * The two ways to take the show bill away with you.
 *
 * **Print / Save as PDF** is the document. Every browser's print dialog has a
 * "Save as PDF" destination, so this produces the real thing — a paginated
 * page with the show's masthead on it — without the app carrying a PDF
 * renderer it would then have to keep looking like the web version. The page
 * has a print stylesheet for exactly this.
 *
 * **Download class list (CSV)** is for the people who want to sort it: barn
 * managers building a run sheet, trainers costing out a weekend. A PDF is the
 * wrong shape for that and a spreadsheet is the wrong shape for a program, so
 * both exist rather than one being made to do the other's job.
 */
export default function ShowbillActions({
  showName,
  classes,
}: {
  showName: string;
  classes: ShowbillClassRow[];
}) {
  const [downloaded, setDownloaded] = useState(false);

  const downloadCsv = () => {
    const esc = (value: string | number | null) => {
      const text = value == null ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = ['Date', 'Class #', 'Class', 'Discipline', 'Division', 'Ring', 'Entry fee'];
    const lines = [
      header.join(','),
      ...classes.map((c) =>
        [
          c.class_date,
          c.class_number,
          c.class_name,
          c.discipline_name ?? '',
          c.division_name ?? '',
          c.ring_name ?? '',
          (c.entry_fee_cents / 100).toFixed(2),
        ]
          .map(esc)
          .join(','),
      ),
    ];
    // \r\n and a BOM: Excel is the overwhelmingly likely destination and it
    // mis-reads a plain UTF-8 CSV's accented characters without one.
    const blob = new Blob(['﻿' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${showName.replace(/[^\w\- ]+/g, '').trim() || 'show'} - class list.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2500);
  };

  return (
    <div className="flex flex-wrap gap-2 mb-5 no-print">
      <button
        type="button"
        onClick={() => window.print()}
        className="text-sm font-medium px-4 py-2 rounded"
        style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
      >
        ⬇ Download / print show bill
      </button>
      <button
        type="button"
        onClick={downloadCsv}
        disabled={classes.length === 0}
        title={classes.length === 0 ? 'No classes have been posted yet' : undefined}
        className="text-sm font-medium px-4 py-2 rounded border disabled:opacity-50"
        style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
      >
        {downloaded ? '✓ Saved' : 'Download class list (CSV)'}
      </button>
    </div>
  );
}
