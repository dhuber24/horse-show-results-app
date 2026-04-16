import LoginForm from './LoginForm';
import Link from 'next/link';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: '#faf7f2' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-5xl">🐴</span>
          <h1 className="text-2xl font-bold mt-3" style={{ color: '#2c1810' }}>Horse Show Results</h1>
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>Sign in to your account</p>
        </div>
        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
          <LoginForm />
        </div>
        <p className="text-center text-sm mt-4" style={{ color: '#8b7355' }}>
          New exhibitor?{' '}
          <Link href="/register" className="font-medium hover:underline" style={{ color: '#8b4513' }}>
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
