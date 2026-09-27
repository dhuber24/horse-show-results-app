'use client';

import { useSyncExternalStore } from 'react';

/**
 * A moment printed in the reader's own time zone.
 *
 * Server components render in the container's zone, which is UTC, so "2:14 PM"
 * formatted there is hours out for everybody at a show in Oklahoma — and
 * `suppressHydrationWarning` only silences the mismatch, it keeps the server's
 * text. So nothing is printed until the browser has hydrated, and then the
 * browser formats it. `useSyncExternalStore` answers "have we hydrated?"
 * without an effect that sets state.
 */

const subscribe = () => () => {};

const DEFAULT_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

export default function LocalTime({
  iso,
  format = DEFAULT_FORMAT,
  className,
  style,
}: {
  iso: string;
  format?: Intl.DateTimeFormatOptions;
  className?: string;
  style?: React.CSSProperties;
}) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const date = new Date(iso);
  const text = hydrated && !Number.isNaN(date.getTime()) ? date.toLocaleString('en-US', format) : '';
  return (
    <time dateTime={iso} className={className} style={style}>
      {text}
    </time>
  );
}
