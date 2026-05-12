'use client';

import { useState } from 'react';
import ExhibitorRegistrations from './ExhibitorRegistrations';

interface Registration {
  id: string;
  show_type_id: string;
  show_type_code: string;
  show_type_name: string;
  member_number: string;
}

interface Certificate {
  id: string;
  document_type: string;
  original_filename: string;
  issue_date: string | null;
  expiry_date: string | null;
  show_type_id: string | null;
}

interface Props {
  exhibitorId: string;
  initialRegistrations: Registration[];
  initialDocuments: Certificate[];
}

export default function ExhibitorMembershipPanel({ exhibitorId, initialRegistrations, initialDocuments }: Props) {
  const [certs, setCerts] = useState<Certificate[]>(initialDocuments);

  return (
    <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
      <h2 className="text-lg font-semibold mb-1" style={{ color: '#2c1810' }}>Association Memberships</h2>
      <p className="text-sm mb-4" style={{ color: '#8b7355' }}>
        Your membership IDs and certificates for each association you compete under.
      </p>
      <ExhibitorRegistrations
        exhibitorId={exhibitorId}
        initialRegistrations={initialRegistrations}
        certificates={certs}
        onCertificateUploaded={(cert) => setCerts((prev) => [...prev, cert])}
        onCertificateDeleted={(certId) => setCerts((prev) => prev.filter((c) => c.id !== certId))}
      />
    </div>
  );
}
