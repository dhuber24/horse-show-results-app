import ForgotPasswordForm from './ForgotPasswordForm';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: '#faf7f2' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-5xl">🐴</span>
          <h1 className="text-2xl font-bold mt-3" style={{ color: '#2c1810' }}>Reset Password</h1>
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            Enter your email and current password to set a new one.
          </p>
        </div>
        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
          <ForgotPasswordForm />
        </div>
        <div className="text-center text-sm mt-4">
          <p style={{ color: '#8b7355' }}>
            Remembered your password?{' '}
            <Link href="/login" className="font-medium hover:underline" style={{ color: '#8b4513' }}>
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
