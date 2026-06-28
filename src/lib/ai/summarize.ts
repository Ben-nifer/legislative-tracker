import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

/**
 * Generates a plain-language AI summary, a short card headline, and assigns
 * topic slugs — all in a single Haiku call for cost efficiency.
 */
export async function generateSummaryAndTopics(
  title: string,
  officialSummary: string | null,
  availableTopics: { name: string; slug: string }[]
): Promise<{ summary: string | null; shortSummary: string | null; topicSlugs: string[]; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { summary: null, shortSummary: null, topicSlugs: [], error: 'ANTHROPIC_API_KEY not set' }

  const content = officialSummary
    ? `Title: ${title}\n\nOfficial summary: ${officialSummary.slice(0, 1000)}`
    : `Title: ${title}`

  const topicList = availableTopics.map((t) => `- ${t.name} (slug: ${t.slug})`).join('\n')

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 420,
      messages: [
        {
          role: 'user',
          content: `Summarize this NYC Council legislation for everyday New Yorkers and assign topics.

${content}

1. Write a plain-language summary in 2–3 sentences: what it does, who it affects, why it matters. No jargon. Present tense.

2. Write a short headline in 5–10 words using plain language. No punctuation at the end.

3. Pick 1–3 topics from this list only:
${topicList}

Respond with valid JSON only:
{"summary":"...","short_summary":"...","topic_slugs":["slug-1"]}`,
        },
      ],
    })

    const block = message.content[0]
    if (block.type !== 'text') return { summary: null, shortSummary: null, topicSlugs: [] }

    // Strip markdown code fences if model wrapped the JSON
    const raw = block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

    const parsed = JSON.parse(raw)
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : null
    const shortSummary = typeof parsed.short_summary === 'string' ? parsed.short_summary.trim() : null
    const topicSlugs = Array.isArray(parsed.topic_slugs)
      ? parsed.topic_slugs.filter((s: unknown) =>
          typeof s === 'string' && availableTopics.some((t) => t.slug === s)
        )
      : []

    return { summary, shortSummary, topicSlugs }
  } catch (e) {
    console.error('[summarize] failed:', e)
    return { summary: null, shortSummary: null, topicSlugs: [], error: String(e) }
  }
}

/**
 * Convenience wrapper — signature kept for compatibility.
 */
export async function summarizeLegislation(
  title: string,
  _legistarUrl: string | null,
  availableTopics: { name: string; slug: string }[] = [],
  officialSummary?: string | null
): Promise<{ summary: string | null; shortSummary: string | null; topicSlugs: string[]; error?: string }> {
  return generateSummaryAndTopics(title, officialSummary ?? null, availableTopics)
}
