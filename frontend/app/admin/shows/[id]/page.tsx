import Link from 'next/link';
import { fetchShow, fetchClasses, fetchHorses, fetchRiders, fetchVenues } from '@/lib/api';
import CreateClassForm from './CreateClassForm';
import CreateHorseForm from './CreateHorseForm';
import CreateRiderForm from './CreateRiderForm';
import CreateEntryForm from './CreateEntryForm';
import ShowStatusControl from './ShowStatusControl';
import EditShowForm from './EditShowForm';

export default async function AdminShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, horses, riders, venues] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchHorses(),
    fetchRiders(),
    fetchVenues(),
  ]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-10">
      <div>
        <Link href="/admin" className="text-sm hover:underline" style={{ color: '#8b4513' }}>← Back to Admin</Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
            <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
              📍 {show.venue} · 📅 {show.start_date} – {show.end_date}
            </p>
            <div className="mt-2">
              <ShowStatusControl showId={id} currentStatus={show.status} />
            </div>
          </div>
          <Link href={`/admin/shows/${id}/back-numbers`}
            className="text-sm px-4 py-2 rounded font-medium whitespace-nowrap"
            style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
            Assign Back #s
          </Link>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>Edit Show</h2>
        <EditShowForm show={show} venues={venues} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>Add Class</h2>
        <CreateClassForm showId={id} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Classes</h2>
        {classes.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No classes yet.</p>
        ) : (
          <ul className="space-y-2">
            {classes.map((cls: any) => (
              <li key={cls.id}
                className="p-3 rounded-lg border flex justify-between items-center"
                style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
                <span className="font-medium" style={{ color: '#2c1810' }}>
                  {cls.class_number} — {cls.class_name}
                </span>
                <span className="text-xs px-2 py-1 rounded-full"
                  style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                  {cls.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>Add Horse</h2>
        <CreateHorseForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>Add Rider</h2>
        <CreateRiderForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>Add Entry</h2>
        <CreateEntryForm showId={id} classes={classes} horses={horses} riders={riders} />
      </section>
    </main>
  );
}
