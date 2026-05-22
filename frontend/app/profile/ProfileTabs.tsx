'use client';

import { useState } from 'react';
import EditAccountForm from './EditAccountForm';
import ChangePasswordForm from './ChangePasswordForm';
import MyHorsesPanel from './MyHorsesPanel';
import TrainerHorsesPanel from './TrainerHorsesPanel';
import TrainerProfileForm, { TrainerProfile } from './TrainerProfileForm';
import TrainerAffiliationsPanel from '@/components/TrainerAffiliationsPanel';
import ExhibitorMembershipPanel from '@/components/ExhibitorMembershipPanel';

interface User { first_name: string; last_name: string; full_name: string; email: string; role: string; created_at: string; }
interface Registration { id: string; show_type_id: string; show_type_code: string; show_type_name: string; member_number: string; }
interface Document {
  id: string; document_type: string; original_filename: string;
  issue_date: string | null; expiry_date: string | null; show_type_id: string | null;
}
interface Horse {
  id: string; name: string; sex: string | null; age: number | null; breed_name: string | null;
  color_name: string | null; is_solid_paint_bred: boolean; owner_exhibitor_id: string | null;
  created_by_exhibitor_id: string | null;
}
interface TrainerHorse {
  id: string; name: string; sex: string | null; age: number | null; breed_name: string | null;
  color_name: string | null; is_solid_paint_bred: boolean; owner_exhibitor_name: string | null;
}
interface Exhibitor {
  id: string;
  date_of_birth: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  parent_guardian_name: string | null;
  parent_guardian_phone: string | null;
}
interface TrainerAffiliation {
  id: string;
  show_type_id: string;
  show_type_code: string;
  show_type_name: string;
  member_number: string;
  status: 'professional' | 'non_pro' | 'general';
  expires_at: string | null;
}

type Tab = 'account' | 'memberships' | 'horses' | 'affiliations';

interface Props {
  user: User;
  role: string;
  exhibitor: Exhibitor | null;
  initialRegistrations: Registration[];
  initialDocuments: Document[];
  initialHorses: Horse[];
  trainerProfile: TrainerProfile | null;
  trainerHorses: TrainerHorse[];
  trainerAffiliations: TrainerAffiliation[];
  initialTab?: Tab;
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors"
      style={{
        color: active ? '#2c1810' : '#8b7355',
        borderBottom: active ? '2px solid #8b4513' : '2px solid transparent',
      }}
    >
      {label}
    </button>
  );
}

export default function ProfileTabs({
  user,
  role,
  exhibitor,
  initialRegistrations,
  initialDocuments,
  initialHorses,
  trainerProfile,
  trainerHorses,
  trainerAffiliations,
  initialTab,
}: Props) {
  const isExhibitor = role === 'EXHIBITOR' && exhibitor !== null;
  const isTrainer = role === 'TRAINER';
  const allowedTabs: Tab[] = isExhibitor
    ? ['account', 'memberships', 'horses']
    : isTrainer
      ? ['account', 'affiliations', 'horses']
      : ['account'];
  const safeInitialTab: Tab = initialTab && allowedTabs.includes(initialTab) ? initialTab : 'account';
  const [activeTab, setActiveTab] = useState<Tab>(safeInitialTab);

  return (
    <div>
      {(isExhibitor || isTrainer) && (
        <div className="flex border-b mb-6" style={{ borderColor: '#d4b896' }}>
          <TabButton label="Account" active={activeTab === 'account'} onClick={() => setActiveTab('account')} />
          {isExhibitor && (
            <TabButton label="Memberships" active={activeTab === 'memberships'} onClick={() => setActiveTab('memberships')} />
          )}
          {isTrainer && (
            <TabButton label="Affiliations" active={activeTab === 'affiliations'} onClick={() => setActiveTab('affiliations')} />
          )}
          {(isExhibitor || isTrainer) && (
            <TabButton
              label={isTrainer ? 'Horses' : 'My Horses'}
              active={activeTab === 'horses'}
              onClick={() => setActiveTab('horses')}
            />
          )}
        </div>
      )}

      {activeTab === 'account' && (
        <div className="space-y-6">
          {!isTrainer && (
            <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
              <h2 className="text-lg font-semibold mb-5" style={{ color: '#2c1810' }}>My Profile</h2>
              <EditAccountForm user={user} exhibitor={isExhibitor ? exhibitor : null} />
            </div>
          )}

          {isTrainer && <TrainerProfileForm trainer={trainerProfile} />}

          <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>Change Password</h2>
            <ChangePasswordForm />
          </div>
        </div>
      )}

      {isExhibitor && activeTab === 'memberships' && (
        <ExhibitorMembershipPanel
          exhibitorId={exhibitor!.id}
          initialRegistrations={initialRegistrations}
          initialDocuments={initialDocuments}
        />
      )}

      {isTrainer && activeTab === 'affiliations' && (
        <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: '#2c1810' }}>Professional Affiliations</h2>
          <p className="text-sm mb-4" style={{ color: '#8b7355' }}>
            Associations you belong to and your status with each (Professional / Non Pro / Member). Status badges show on your public profile when it&rsquo;s turned on.
          </p>
          <TrainerAffiliationsPanel initialAffiliations={trainerAffiliations} />
        </div>
      )}

      {isExhibitor && activeTab === 'horses' && (
        <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
          <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>My Horses</h2>
          <MyHorsesPanel
            exhibitorId={exhibitor!.id}
            initialHorses={initialHorses}
          />
        </div>
      )}

      {isTrainer && activeTab === 'horses' && (
        <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>Horses</h2>
            <span className="text-xs" style={{ color: '#8b7355' }}>
              {trainerHorses.length} linked
            </span>
          </div>
          <TrainerHorsesPanel horses={trainerHorses} />
        </div>
      )}
    </div>
  );
}
