import { fetchShow, fetchClasses, fetchResultsIndex } from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';
import ResultsSearch from './ResultsSearch';

export default async function ShowResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, resultsIndex] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchResultsIndex(id),
  ]);
  const visible = classes.filter((c: any) => c.status !== 'DRAFT');

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={`/shows/${id}/live`} backLabel="Back to Show Menu" />

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Results</h2>

      {visible.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No classes have been posted yet.</p>
      ) : (
        <ResultsSearch showId={id} classes={visible} resultsIndex={resultsIndex} />
      )}
    </main>
  );
}
