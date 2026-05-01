'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-8 text-center space-y-4">
      <p style={{ color: '#8b1a1a' }}>Something went wrong.</p>
      <p className="text-sm" style={{ color: '#8b7355' }}>{error.message}</p>
      <button onClick={reset} className="px-4 py-2 rounded text-sm font-medium"
        style={{ backgroundColor: '#8b4513', color: '#fff' }}>
        Try again
      </button>
    </div>
  );
}
