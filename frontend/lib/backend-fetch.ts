import { auth } from '@/auth';

export const API_URL = process.env.API_URL || 'http://backend:8000';

/**
 * Returns headers for authenticated server-to-backend requests.
 * Returns null if no session exists (caller should respond 401).
 */
export async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const session = await auth();
  if (!session?.user) return null;
  const accessToken = (session as any).accessToken;
  if (!accessToken) return null;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
}
