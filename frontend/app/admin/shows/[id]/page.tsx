import Link from 'next/link';
import { fetchShow, fetchClasses, fetchHorses, fetchRiders } from '@/lib/api';
import CreateClassForm from './CreateClassForm';
import CreateHorseForm from './CreateHorseForm';
import CreateRiderForm from './CreateRiderForm';
import CreateEntryForm from './CreateEntryForm';

export default async function AdminShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, horses, riders] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchHorses(),
    fetchRiders(),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-10">
      <div>
        <Link href="/admin" className="text-sm text-blue-500 hover:underline">← Back to Admin</Link>
        <h1 className="text-3xl font-bold mt-2">{show.name}</h1>
        <p className="text-gray-500">{show.venue} · {show.start_date} – {show.end_date}</p>
      </div>

      <section>
        <h2 className="text-xl font-semibold mb-4">Add Class</h2>
        <CreateClassForm showId={id} />
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Classes</h2>
        {classes.length === 0 ? <p className="text-gray-500">No classes yet.</p> : (
          <ul className="space-y-2">
            {classes.map((cls: any) => (
              <li key={cls.id} className="p-3 border rounded-lg flex justify-between items-center">
                <span className="font-medium">{cls.class_number} — {cls.class_name}</span>
                <span className="text-sm text-gray-500 uppercase">{cls.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Add Horse</h2>
        <CreateHorseForm />
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Add Rider</h2>
        <CreateRiderForm />
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Add Entry</h2>
        <CreateEntryForm showId={id} classes={classes} horses={horses} riders={riders} />
      </section>
    </main>
  );
}
