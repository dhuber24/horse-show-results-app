'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-8 text-center space-y-4">
      <p style={{ color: 'var(--error-strong)' }}>Something went wrong.</p>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>{error.message}</p>
      <button onClick={reset} className="px-4 py-2 rounded text-sm font-medium"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}>
        Try again
      </button>
    </div>
  );
}
