import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export const API_URL = process.env.API_URL || 'http://backend:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/**
 * Returns headers for authenticated server-to-backend requests.
 * Returns null if no session exists (caller should respond 401).
 */
export async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    'Content-Type': 'application/json',
    'X-API-Key': INTERNAL_API_KEY,
    'X-User-Id': session.user.id,
    'X-User-Role': session.user.role,
  };
}

/**
 * Parses a backend response body as JSON, tolerating a body that isn't JSON.
 *
 * Not every backend failure is a JSON error envelope: an unhandled exception
 * comes back as plain text, and calling res.json() on it throws. In a server
 * component that throw escapes the page and renders the error boundary, so a
 * page that already has a perfectly good "couldn't load this" branch never
 * gets to show it — and the real status is replaced by an opaque
 * "Unexpected token" parse error. Returns null instead, letting the caller
 * fall back to its own message.
 */
export async function readJsonBody(res: Response): Promise<any> {
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Safely fetch from backend with error handling.
 * Returns parsed JSON response on success, or error response object.
 */
export async function safeFetchBackend(
  url: string,
  options: RequestInit & { headers: Record<string, string> },
): Promise<{ json: any; status: number; error?: string }> {
  try {
    const res = await fetch(url, options);
    if (res.status === 204) {
      return { json: null, status: 204 };
    }
    try {
      const json = await res.json();
      return { json, status: res.status };
    } catch (parseError) {
      return {
        json: { error: 'Invalid JSON response from backend' },
        status: res.status,
        error: `JSON parse error: ${parseError instanceof Error ? parseError.message : 'unknown'}`,
      };
    }
  } catch (networkError) {
    return {
      json: { error: 'Backend unavailable' },
      status: 502,
      error: `Network error: ${networkError instanceof Error ? networkError.message : 'unknown'}`,
    };
  }
}
