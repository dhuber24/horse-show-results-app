'use client';

import { useState } from 'react';
import type { ShowbillClassRow } from './ShowbillDocument';

/**
 * The class list as a spreadsheet.
 *
 * For the people who want to sort it: barn managers building a run sheet,
 * trainers costing out a weekend. A PDF is the wrong shape for that and a
 * spreadsheet is the wrong shape for a program, so both exist rather than one
 * being made to do the other's job.
 *
 * Its own component because it belongs to **both** show bills. The generated
 * one carries it beside Print; a show that uploaded its own bill still has a
 * class schedule in this app, and losing the export because the show supplied
 * its own PDF would be the uploaded bill hiding the app's live data — which is
 * the one thing that feature is not allowed to do.
 */
export default function ClassListCsvButton({
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
    const header = [
      'Date', 'Class #', 'Class', 'Discipline', 'Division', 'Ring', 'Entry fee', 'Sanctioned by',
    ];
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
          // The sheet has to say which classes carry a club's per-class fee;
          // without it the spreadsheet cannot reproduce the printed bill.
          (c.sanctioning_codes ?? []).join(' '),
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
  );
}
