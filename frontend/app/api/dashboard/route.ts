import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

const API_URL = process.env.API_URL || 'http://backend:8000';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id;
  const res = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`);
  const json = await res.json();
  return NextResponse.json(json);
}
