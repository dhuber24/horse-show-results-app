interface TrainerHorse {
  id: string;
  name: string;
  owner_exhibitor_name: string | null;
  sex: string | null;
  age: number | null;
  breed_name: string | null;
  color_name: string | null;
  is_solid_paint_bred: boolean;
}

export default function TrainerHorsesPanel({ horses }: { horses: TrainerHorse[] }) {
  if (horses.length === 0) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf7f2' }}>
        <p className="text-sm" style={{ color: '#8b7355' }}>
          No horses are linked to your trainer profile yet. When exhibitors select you from the Trainer dropdown on a horse profile, that horse will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y" style={{ borderColor: '#f0e4d0' }}>
      {horses.map((horse) => (
        <li key={horse.id} className="py-3 first:pt-0 last:pb-0">
          <div className="font-medium text-sm flex items-center flex-wrap gap-1.5" style={{ color: '#2c1810' }}>
            {horse.name}
            {horse.sex && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                {horse.sex}
              </span>
            )}
            {horse.is_solid_paint_bred && (
              <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                SPB
              </span>
            )}
          </div>
          <div className="text-xs mt-1 flex flex-wrap gap-x-2 gap-y-1" style={{ color: '#8b7355' }}>
            {horse.owner_exhibitor_name && <span>Owner: {horse.owner_exhibitor_name}</span>}
            {horse.breed_name && <span>{horse.breed_name}</span>}
            {horse.color_name && <span>{horse.color_name}</span>}
            {horse.age !== null && horse.age !== undefined && <span>Age: {horse.age}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
