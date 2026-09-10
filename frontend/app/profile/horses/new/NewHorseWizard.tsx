'use client';

import { useRouter } from 'next/navigation';
import AddHorseWizard from '../../AddHorseWizard';
import { MyHorse } from '../../horse-shared';
import { safeNextPath } from '@/lib/safe-next';

interface Props {
  exhibitorId: string;
  profileHorseIds: string[];
  initialName?: string;
  initialRegAssociationId?: string;
  initialRegNumber?: string;
  /** Where the exhibitor came from, to be returned to when the wizard is done.
   *  Set by the show-registration screen, which sends them here mid-flow. */
  nextPath?: string;
}

/**
 * Wires the wizard's outcomes to navigation. Whether the horse was created or an
 * existing one was linked, the exhibitor ends up back where they started.
 *
 * **Usually that is My Horses, but not when they came from a registration.**
 * Adding a horse is a six-step detour on another route, and dropping somebody
 * on their profile afterwards means finding the show again and re-opening the
 * step they were on — which is most of the reason people abandon a registration
 * half-done. `?next=` carries the way back, and the registration screen puts
 * `?step=horses` on it so the box they left is the box they return to.
 *
 * The value is a URL a stranger can compose, so it goes through `safeNextPath`
 * before it is used: same-origin absolute paths only, anything else falls back
 * to the profile. Cancelling honours it too — somebody who changes their mind
 * about adding a horse still wants to be back at their registration.
 *
 * No `router.refresh()` here: `/profile` fetches with `cache: 'no-store'`, so the
 * push already lands on fresh data, and refreshing in the same tick cancels the
 * in-flight navigation and strands the wizard on screen.
 */
export default function NewHorseWizard({
  exhibitorId, profileHorseIds, initialName, initialRegAssociationId, initialRegNumber,
  nextPath,
}: Props) {
  const router = useRouter();

  const destination = safeNextPath(nextPath) ?? '/profile?tab=horses';
  const goBack = (_horse?: MyHorse) => {
    router.push(destination);
  };

  return (
    <AddHorseWizard
      exhibitorId={exhibitorId}
      profileHorseIds={new Set(profileHorseIds)}
      initialName={initialName}
      initialRegAssociationId={initialRegAssociationId}
      initialRegNumber={initialRegNumber}
      onCreated={goBack}
      onLinked={goBack}
      onCancel={() => goBack()}
    />
  );
}
