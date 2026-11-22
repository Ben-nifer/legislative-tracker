import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

/**
 * Generates a plain-language AI summary for a ULURP or DOT local proposal.
 * Same fail-soft contract as src/lib/ai/summarize.ts — never throws.
 */
export async function generateProposalSummary(
  title: string,
  description: string | null,
  family: 'ulurp' | 'dot'
): Promise<{ summary: string | null; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { summary: null, error: 'ANTHROPIC_API_KEY not set' }

  const content = description
    ? `Title: ${title}\n\nDescription: ${description.slice(0, 1000)}`
    : `Title: ${title}`

  const context =
    family === 'ulurp'
      ? 'a NYC land use / zoning (ULURP) application — a proposed housing development or rezoning'
      : 'a NYC Department of Transportation street redesign or capital construction project'

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Summarize this for everyday New Yorkers. It is ${context}.

${content}

Write a plain-language summary in 2–3 sentences: what it is, where, and why it matters to nearby residents. No jargon. Present tense.

Respond with valid JSON only:
{"summary":"..."}`,
        },
      ],
    })

    const block = message.content[0]
    if (block.type !== 'text') return { summary: null }

    const raw = block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(raw)
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : null

    return { summary }
  } catch (e) {
    console.error('[summarize-proposal] failed:', e)
    return { summary: null, error: String(e) }
  }
}
