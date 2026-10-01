'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStepAutosaveFlush } from '../admin/shows/[id]/setup/_lib/StepAutosave';

/**
 * A sidebar link: saves the setup step it is leaving, if it is leaving one, and
 * then goes.
 *
 * Off a step, nothing is registered and it is an ordinary in-place navigation.
 * Leaving a step, it saves first and then loads the page in full, for the reason
 * `AutosaveNavLink` gives: the save has just written rows the next page reads on
 * the server. A save that fails keeps somebody on the step, whose own error is
 * on screen by then.
 *
 * **An anchor, not the button `AutosaveNavLink` is.** The setup tabs are buttons
 * so that a middle-click cannot leave a step unsaved behind a new tab. In a
 * sidebar, opening Financials in a second tab while the desk stays open in this
 * one is the whole point of a desktop, and the step being left behind is still
 * open, unsaved work and all, in the tab that was not navigated. So a modified
 * click is the browser's, and only a plain click saves and moves.
 */
export default function SidebarLink({
  href,
  className,
  style,
  title,
  children,
}: {
  href: string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const flush = useStepAutosaveFlush();
  const [busy, setBusy] = useState(false);

  return (
    <a
      href={href}
      className={className}
      style={busy ? { ...style, opacity: 0.6 } : style}
      title={title}
      aria-busy={busy || undefined}
      onClick={async (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        let leftAStep: boolean;
        try {
          leftAStep = await flush();
        } catch {
          setBusy(false);
          return;
        }
        if (leftAStep) {
          window.location.assign(href);
          return;
        }
        router.push(href);
        setBusy(false);
      }}
    >
      {children}
    </a>
  );
}
