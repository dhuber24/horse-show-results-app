'use client';

interface Breed {
  id: string;
  name: string;
}

interface Props {
  breeds: Breed[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  label?: string;
}

export default function BreedCheckboxGroup({ breeds, selectedIds, onChange, label = 'Breeds' }: Props) {
  const selected = new Set(selectedIds);

  const toggleBreed = (breedId: string) => {
    if (selected.has(breedId)) {
      onChange(selectedIds.filter((id) => id !== breedId));
      return;
    }
    onChange([...selectedIds, breedId]);
  };

  return (
    <div>
      <label className="text-sm block mb-1" style={{ color: '#8b7355' }}>{label}</label>
      <div className="max-h-44 overflow-y-auto rounded border bg-white p-2" style={{ borderColor: '#d4b896' }}>
        {breeds.length === 0 ? (
          <p className="text-sm px-1 py-1" style={{ color: '#8b7355' }}>No breeds available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {breeds.map((breed) => (
              <label key={breed.id} className="flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-amber-50/60" style={{ color: '#2c1810' }}>
                <input
                  type="checkbox"
                  checked={selected.has(breed.id)}
                  onChange={() => toggleBreed(breed.id)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>{breed.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
