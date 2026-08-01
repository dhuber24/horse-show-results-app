'use client';

import { useRouter } from 'next/navigation';
import AddHorseWizard from '../../AddHorseWizard';
import { MyHorse } from '../../horse-shared';

interface Props {
  exhibitorId: string;
  profileHorseIds: string[];
  initialName?: string;
  initialRegAssociationId?: string;
  initialRegNumber?: string;
}

/**
 * Wires the wizard's outcomes to navigation. Whether the horse was created or an
 * existing one was linked, the exhibitor ends up back on the My Horses list.
 *
 * No `router.refresh()` here: `/profile` fetches with `cache: 'no-store'`, so the
 * push already lands on fresh data, and refreshing in the same tick cancels the
 * in-flight navigation and strands the wizard on screen.
 */
export default function NewHorseWizard({
  exhibitorId, profileHorseIds, initialName, initialRegAssociationId, initialRegNumber,
}: Props) {
  const router = useRouter();

  const backToList = (_horse?: MyHorse) => {
    router.push('/profile?tab=horses');
  };

  return (
    <AddHorseWizard
      exhibitorId={exhibitorId}
      profileHorseIds={new Set(profileHorseIds)}
      initialName={initialName}
      initialRegAssociationId={initialRegAssociationId}
      initialRegNumber={initialRegNumber}
      onCreated={backToList}
      onLinked={backToList}
      onCancel={() => backToList()}
    />
  );
}
