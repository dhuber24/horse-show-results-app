import type { Metadata } from 'next';
import LegalDocument from '@/components/LegalDocument';
import { PRIVACY_EFFECTIVE, PRIVACY_MARKDOWN } from '@/lib/legal/privacy';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What personal information GaitDesk collects, how it is used and shared, and the choices you have.',
};

/** The Privacy Policy. The text is `lib/legal/privacy.ts`; the site footer and
 *  the Terms of Service link here. */
export default function PrivacyPage() {
  return <LegalDocument title="Privacy Policy" effective={PRIVACY_EFFECTIVE} markdown={PRIVACY_MARKDOWN} />;
}
