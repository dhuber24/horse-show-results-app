import { fetchShow } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import JudgesEditor from './JudgesEditor';
import { fetchJudgeSetupData } from './fetchJudgeSetupData';

export default async function JudgesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, judgeData] = await Promise.all([
    fetchShow(id),
    fetchJudgeSetupData(id, headers || {}),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Judges' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Judges</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — pick the judges officiating this show.
        </p>
      </div>

      <JudgesEditor
        showId={id}
        initialJudges={judgeData.judges}
        registryJudges={judgeData.registryJudges}
        associations={judgeData.associations}
      />
    </main>
  );
}
