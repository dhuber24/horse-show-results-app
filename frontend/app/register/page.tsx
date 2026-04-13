import RegisterForm from './RegisterForm';

export default function RegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-2xl font-bold mb-2 text-center">🐴 Create Rider Account</h1>
        <p className="text-gray-500 text-sm text-center mb-6">Sign up to view your entries and results</p>
        <RegisterForm />
      </div>
    </main>
  );
}
