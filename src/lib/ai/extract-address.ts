import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

/**
 * Extracts a single geocodable NYC street address or intersection from a
 * ULURP project title/description, if one is confidently present. Same
 * fail-soft contract as the other src/lib/ai/* helpers — never throws.
 */
export async function extractAddress(
  title: string,
  description: string | null,
  borough: string | null
): Promise<{ address: string | null; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { address: null, error: 'ANTHROPIC_API_KEY not set' }

  const content = description
    ? `Title: ${title}\n\nDescription: ${description.slice(0, 500)}`
    : `Title: ${title}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `This is a NYC ULURP (land use) application title/description${borough ? ` in ${borough}` : ''}.

${content}

If it contains a specific street address or intersection (e.g. "241-251 W 28 Street", "corner of 5th Ave and 42nd St"), extract it as a single geocodable address string${borough ? `, including "${borough}, NY"` : ', including the borough if mentioned'}. If no specific address or intersection is present (e.g. it only names a project, applicant, or a whole neighborhood/zoning district), return null.

Respond with valid JSON only:
{"address": "..." or null}`,
        },
      ],
    })

    const block = message.content[0]
    if (block.type !== 'text') return { address: null }

    const raw = block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(raw)
    const address = typeof parsed.address === 'string' && parsed.address.trim() ? parsed.address.trim() : null

    return { address }
  } catch (e) {
    console.error('[extract-address] failed:', e)
    return { address: null, error: String(e) }
  }
}
