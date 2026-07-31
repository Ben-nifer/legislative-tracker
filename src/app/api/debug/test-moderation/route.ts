import { NextResponse } from 'next/server'

// Temporary diagnostic route to confirm the OpenAI moderation integration is
// actually working in production. Remove after use.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.DEBUG_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  const hasKey = Boolean(apiKey)
  const keyPrefix = apiKey ? apiKey.slice(0, 7) : null

  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: 'I want to kill them.' }),
    })

    const bodyText = await res.text()

    return NextResponse.json({
      hasKey,
      keyPrefix,
      httpStatus: res.status,
      ok: res.ok,
      body: bodyText.slice(0, 1000),
    })
  } catch (error) {
    return NextResponse.json({
      hasKey,
      keyPrefix,
      fetchError: error instanceof Error ? error.message : String(error),
    })
  }
}
