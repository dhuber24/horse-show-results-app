import type { Metadata } from 'next';
import LegalDocument from '@/components/LegalDocument';
import { TERMS_EFFECTIVE, TERMS_MARKDOWN } from '@/lib/legal/terms';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms for using GaitDesk, and the plan, license and payment terms for show companies and trainers.',
};

/** The Terms of Service. The text is `lib/legal/terms.ts`; the site footer
 *  links here from every page. */
export default function TermsPage() {
  return <LegalDocument title="Terms of Service" effective={TERMS_EFFECTIVE} markdown={TERMS_MARKDOWN} />;
}
