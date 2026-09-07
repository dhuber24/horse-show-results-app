'use client';

import { useState } from 'react';
import ExhibitorRegistrations, { type Registration } from './ExhibitorRegistrations';
import ExhibitorCompetitionCards, { type CompetitionCard } from './ExhibitorCompetitionCards';

interface Certificate {
  id: string;
  document_type: string;
  original_filename: string;
  issue_date: string | null;
  expiry_date: string | null;
  association_id: string | null;
}

interface Props {
  exhibitorId: string;
  initialRegistrations: Registration[];
  initialDocuments: Certificate[];
  initialCompetitionCards: CompetitionCard[];
}

export default function ExhibitorMembershipPanel({
  exhibitorId,
  initialRegistrations,
  initialDocuments,
  initialCompetitionCards,
}: Props) {
  const [certs, setCerts] = useState<Certificate[]>(initialDocuments);
  // Held here rather than inside ExhibitorRegistrations because the cards
  // section below needs it: a competition card is issued to a member, so
  // filing an APHA membership has to make the card picker appear without a
  // page reload.
  const [regs, setRegs] = useState<Registration[]>(initialRegistrations);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--foreground)' }}>Association Memberships</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
          Your membership IDs and certificates for each association you compete under.
        </p>
        <ExhibitorRegistrations
          exhibitorId={exhibitorId}
          initialRegistrations={initialRegistrations}
          certificates={certs}
          onCertificateUploaded={(cert) => setCerts((prev) => [...prev, cert])}
          onCertificateDeleted={(certId) => setCerts((prev) => prev.filter((c) => c.id !== certId))}
          onRegistrationsChanged={setRegs}
        />
      </div>

      {/*
        A separate box, not a third list inside the one above. A membership says
        you belong to the association; a competition card says which division
        you may enter, and it is the one that has to be bought again every
        January. Somebody scanning this tab in December is looking for the
        second thing.
      */}
      <ExhibitorCompetitionCards
        exhibitorId={exhibitorId}
        initialCards={initialCompetitionCards}
        memberships={regs}
      />
    </div>
  );
}
