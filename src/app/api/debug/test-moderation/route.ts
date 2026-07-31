import { NextResponse } from 'next/server'
import { checkModeration } from '@/lib/moderation/check'

// Temporary diagnostic route to confirm the OpenAI moderation integration is
// actually working in production. Remove after use.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.DEBUG_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hasKey = Boolean(process.env.OPENAI_API_KEY)
  const result = await checkModeration('I want to kill them.')

  return NextResponse.json({ hasKey, result })
}
