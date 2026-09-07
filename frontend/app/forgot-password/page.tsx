import ForgotPasswordForm from './ForgotPasswordForm';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--background)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-5xl">🐴</span>
          <h1 className="text-2xl font-bold mt-3" style={{ color: 'var(--foreground)' }}>Reset Password</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Answer your security question to set a new password.
          </p>
        </div>
        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <ForgotPasswordForm />
        </div>
        <div className="text-center text-sm mt-4">
          <p style={{ color: 'var(--muted)' }}>
            Remembered your password?{' '}
            <Link href="/login" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
