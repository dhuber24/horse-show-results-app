'use client';

import { useState } from 'react';

/**
 * The approval link, shown to the person who sent the request.
 *
 * SMTP is optional in this deployment, so the email may never arrive — and even
 * where it does, it lands in a spam folder often enough that "we emailed them"
 * is not a plan. The link is always on screen to copy and send by text, so an
 * undelivered email is never the reason a horse can't change hands.
 *
 * Handing the link to the requester is also why the link cannot be the
 * permission: the backend requires whoever opens it to be signed in as the
 * owner. The copy below says so, because a requester who follows their own
 * link and hits "not yours to answer" should have been told to expect it.
 */
export default function ApprovalLinkCallout({
  url,
  emailSent,
  approverName,
}: {
  url: string;
  emailSent: boolean | null;
  approverName: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions). The input
      // below is selectable, so there is still a way through.
      setCopied(false);
    }
  };

  return (
    <div className="rounded border p-3 space-y-2" style={{ borderColor: '#86efac', backgroundColor: '#f0fdf4' }}>
      <p className="text-xs" style={{ color: '#166534' }}>
        {emailSent
          ? `We emailed the approval link to ${approverName}.`
          : `We couldn't email ${approverName}, so send them this link yourself.`}{' '}
        {approverName} has to open it while signed in to their own account — the link finds the
        request, but only they can approve it.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 border rounded px-2 py-1.5 text-xs font-mono"
          style={{ borderColor: '#86efac', backgroundColor: '#ffffff', color: '#166534' }}
          aria-label="Approval link"
        />
        <button
          type="button"
          onClick={copy}
          className="px-3 py-1.5 rounded text-xs font-medium shrink-0"
          style={{ backgroundColor: '#166534', color: '#f0fdf4' }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
