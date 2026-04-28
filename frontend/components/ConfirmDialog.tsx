'use client';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
  destructive?: boolean;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  confirming = false,
  destructive = false,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={!confirming ? onCancel : undefined}
      />
      <div className="relative bg-white rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4">
        <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>
          {title}
        </h2>
        <p className="text-sm" style={{ color: '#5a3e2b' }}>
          {message}
        </p>
        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onCancel}
            disabled={confirming}
            className="px-4 py-2 rounded text-sm font-medium border disabled:opacity-50"
            style={{ color: '#5a3e2b', borderColor: '#d4b896' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className={`px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirming ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
