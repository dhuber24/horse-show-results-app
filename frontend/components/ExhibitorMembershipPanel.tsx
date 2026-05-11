'use client';

import { useState } from 'react';
import ExhibitorRegistrations from './ExhibitorRegistrations';
import ExhibitorDocuments from './ExhibitorDocuments';

interface Registration {
  id: string;
  show_type_id: string;
  show_type_code: string;
  show_type_name: string;
  member_number: string;
}

interface Document {
  id: string;
  document_type: string;
  document_type_label: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  issue_date: string | null;
  expiry_date: string | null;
  show_type_id: string | null;
  show_type_code: string | null;
  show_type_name: string | null;
  created_at: string;
}

interface Props {
  exhibitorId: string;
  initialRegistrations: Registration[];
  initialDocuments: Document[];
}

export default function ExhibitorMembershipPanel({ exhibitorId, initialRegistrations, initialDocuments }: Props) {
  const [docs, setDocs] = useState<Document[]>(initialDocuments);

  return (
    <>
      <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
        <h2 className="text-lg font-semibold mb-1" style={{ color: '#2c1810' }}>Association Memberships</h2>
        <p className="text-sm mb-4" style={{ color: '#8b7355' }}>
          Your membership IDs for each association you compete under.
        </p>
        <ExhibitorRegistrations
          exhibitorId={exhibitorId}
          initialRegistrations={initialRegistrations}
          documents={docs}
        />
      </div>

      <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
        <h2 className="text-lg font-semibold mb-1" style={{ color: '#2c1810' }}>My Documents</h2>
        <p className="text-sm mb-4" style={{ color: '#8b7355' }}>
          Certifications and documents attached to your exhibitor profile.
        </p>
        <ExhibitorDocuments
          exhibitorId={exhibitorId}
          initialDocuments={docs}
          onDocumentsChange={setDocs}
        />
      </div>
    </>
  );
}
