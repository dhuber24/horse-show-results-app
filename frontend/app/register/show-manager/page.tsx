import ShowManagerRegisterForm from './ShowManagerRegisterForm';
import Link from 'next/link';

export default function ShowManagerRegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#faf7f2' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-5xl">🏟️</span>
          <h1 className="text-2xl font-bold mt-3" style={{ color: '#2c1810' }}>Show Manager Registration</h1>
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            Create an account to host and manage horse shows
          </p>
        </div>
        <div className="rounded-lg border p-6 shadow-sm" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
          <ShowManagerRegisterForm />
        </div>
        <div className="text-center text-sm mt-4 space-y-1">
          <p style={{ color: '#8b7355' }}>
            Already have an account?{' '}
            <Link href="/login" className="font-medium hover:underline" style={{ color: '#8b4513' }}>
              Sign in
            </Link>
          </p>
          <p style={{ color: '#8b7355' }}>
            Registering as a show secretary?{' '}
            <Link href="/register/show-secretary" className="font-medium hover:underline" style={{ color: '#8b4513' }}>
              Show Secretary registration
            </Link>
          </p>
          <p style={{ color: '#8b7355' }}>
            Registering as an exhibitor?{' '}
            <Link href="/register" className="font-medium hover:underline" style={{ color: '#8b4513' }}>
              Exhibitor registration
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
