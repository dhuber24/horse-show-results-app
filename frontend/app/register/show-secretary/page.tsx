import { redirect } from 'next/navigation';

/** Kept so links and bookmarks to the old secretary-only screen still work. */
export default function ShowSecretaryRegisterPage() {
  redirect('/register/show-office?role=secretary');
}
