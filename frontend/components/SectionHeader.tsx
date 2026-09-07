export default function SectionHeader({
  title,
  open,
  onToggle,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} className="flex items-center justify-between w-full text-left">
      <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>{title}</h2>
      <span className="text-sm select-none font-bold" style={{ color: 'var(--muted)' }}>{open ? '−' : '+'}</span>
    </button>
  );
}
