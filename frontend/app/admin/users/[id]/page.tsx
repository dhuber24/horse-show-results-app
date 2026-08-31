import Link from 'next/link';
import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import { API_URL } from '@/lib/backend-fetch';
import EditUserForm from './EditUserForm';
import ChangeRoleForm from './ChangeRoleForm';
import ResetPasswordForm from './ResetPasswordForm';
import SecurityQuestionPanel from './SecurityQuestionPanel';
import DeleteUserButton from './DeleteUserButton';
import Breadcrumbs from '@/components/Breadcrumbs';
import AdminTrainerDetail from '@/app/admin/trainers/[id]/AdminTrainerDetail';
import { coatDescription } from '@/lib/horse-coat';

async function getUser(id: string, headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/users/${id}`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function getExhibitorByUser(userId: string, headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/exhibitors/by-user/${userId}`, { headers, cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

async function getExhibitorHorses(exhibitorId: string, headers: Record<string, string>): Promise<any[]> {
  const res = await fetch(`${API_URL}/exhibitors/${exhibitorId}/owned-horses`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function getTrainerByUser(userId: string, headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/trainers/`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  const trainers = await res.json();
  return trainers.find((t: { user_id: string | null }) => t.user_id === userId) ?? null;
}

async function getTrainerAffiliations(trainerId: string, headers: Record<string, string>): Promise<any[]> {
  const res = await fetch(`${API_URL}/trainers/${trainerId}/registrations`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function getTrainerHorses(trainerId: string, headers: Record<string, string>): Promise<any[]> {
  const res = await fetch(`${API_URL}/trainers/${trainerId}/horses`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const sessionUser = session.user as any;
  if (sessionUser.role !== 'ADMIN') redirect('/admin');

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.INTERNAL_API_KEY || '',
    'X-User-Id': sessionUser.id ?? '',
    'X-User-Role': sessionUser.role ?? '',
  };

  const user = await getUser(id, headers);
  if (!user) notFound();

  let exhibitor: any = null;
  let exhibitorHorses: any[] = [];
  let trainer: any = null;
  let trainerAffiliations: any[] = [];
  let trainerHorses: any[] = [];

  if (user.role === 'EXHIBITOR') {
    exhibitor = await getExhibitorByUser(user.id, headers);
    if (exhibitor) {
      exhibitorHorses = await getExhibitorHorses(exhibitor.id, headers);
    }
  }

  if (user.role === 'TRAINER') {
    trainer = await getTrainerByUser(user.id, headers);
    if (trainer) {
      [trainerAffiliations, trainerHorses] = await Promise.all([
        getTrainerAffiliations(trainer.id, headers),
        getTrainerHorses(trainer.id, headers),
      ]);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Users', href: '/admin/users' },
          { label: user.full_name },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          {user.full_name}
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{user.email}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: '#b0956e' }}>
          <span>Joined {new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          <span>Last login: {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never'}</span>
          <span>
            AQHA workshop: {user.aqha_management_workshop_completed_at
              ? new Date(user.aqha_management_workshop_completed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
              : 'Not recorded'}
          </span>
        </div>
      </div>

      {user.role === 'TRAINER' ? (
        <section className="p-5 rounded-lg border space-y-1" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
          <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Trainer Profile</h2>
          {trainer ? (
            <AdminTrainerDetail
              trainer={trainer}
              initialAffiliations={trainerAffiliations}
              initialHorses={trainerHorses}
            />
          ) : (
            <p className="text-sm" style={{ color: '#8b7355' }}>
              No trainer registry row is linked to this account.
            </p>
          )}
        </section>
      ) : (
        <section className="p-5 rounded-lg border space-y-1" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
          <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Profile</h2>
          <EditUserForm user={user} />
        </section>
      )}

      <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Role</h2>
        <ChangeRoleForm user={user} />
      </section>

      {user.role === 'EXHIBITOR' && (
        <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
          <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Horses</h2>
          {!exhibitor ? (
            <p className="text-sm" style={{ color: '#8b7355' }}>No exhibitor profile linked to this account.</p>
          ) : exhibitorHorses.length === 0 ? (
            <p className="text-sm" style={{ color: '#8b7355' }}>No horses registered to this exhibitor.</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: '#f0e4d0' }}>
              {exhibitorHorses.map((horse: any) => (
                <li key={horse.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div>
                    <div className="font-medium text-sm" style={{ color: '#2c1810' }}>
                      {horse.name}
                      {horse.sex && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                          {horse.sex}
                        </span>
                      )}
                    </div>
                    <div className="text-xs mt-0.5 flex gap-x-2" style={{ color: '#8b7355' }}>
                      {horse.breed_name && <span>{horse.breed_name}</span>}
                      {coatDescription(horse.color_name, horse.pattern_name) && (
                                              <span>{coatDescription(horse.color_name, horse.pattern_name)}</span>
                                            )}
                      {horse.age !== null && horse.age !== undefined && <span>Age: {horse.age}</span>}
                    </div>
                  </div>
                  <Link
                    href={`/admin/horses/${horse.id}`}
                    className="text-sm ml-4 shrink-0 hover:underline"
                    style={{ color: '#8b4513' }}
                  >
                    Edit →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Reset Password</h2>
        <ResetPasswordForm userId={user.id} />
      </section>

      <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Security Question</h2>
        <SecurityQuestionPanel userId={user.id} />
      </section>

      <section className="p-5 rounded-lg border" style={{ borderColor: '#fca5a5', backgroundColor: '#fff9f9' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#991b1b' }}>Danger Zone</h2>
        <DeleteUserButton userId={user.id} userName={user.full_name} />
      </section>

      <p className="text-xs font-mono" style={{ color: '#8b7355' }}>ID: {user.id}</p>
    </main>
  );
}
