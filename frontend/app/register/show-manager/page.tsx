import { redirect } from 'next/navigation';

/** Kept so links and bookmarks to the old manager-only screen still work. */
export default function ShowManagerRegisterPage() {
  redirect('/register/show-office?role=manager');
}
