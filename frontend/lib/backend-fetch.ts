import { auth } from '@/auth';

export const API_URL = process.env.API_URL || 'http://backend:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/**
 * Returns headers for authenticated server-to-backend requests.
 * Returns null if no session exists (caller should respond 401).
 */
export async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const session = await auth();
  if (!session?.user) return null;
  const user = session.user as any;
  return {
    'Content-Type': 'application/json',
    'X-API-Key': INTERNAL_API_KEY,
    'X-User-Id': user.id ?? '',
    'X-User-Role': user.role ?? '',
  };
}
