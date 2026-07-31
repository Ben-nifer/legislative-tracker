export type ModerationResult = {
  flagged: boolean
  categories: string[]
}

/**
 * Checks text against OpenAI's free moderation API.
 * Fails open — if the API is unavailable or unconfigured, the content is allowed.
 */
export async function checkModeration(text: string): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('Moderation skipped: OPENAI_API_KEY is not set')
    return { flagged: false, categories: [] }
  }

  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: text }),
    })

    if (!res.ok) {
      console.error('Moderation API request failed:', res.status, await res.text())
      return { flagged: false, categories: [] }
    }

    const data = await res.json()
    const result = data.results?.[0]
    if (!result) return { flagged: false, categories: [] }

    const flaggedCategories = Object.entries(result.categories ?? {})
      .filter(([, value]) => value === true)
      .map(([key]) => key)

    return { flagged: result.flagged ?? false, categories: flaggedCategories }
  } catch (error) {
    // Never block a post due to a moderation API failure
    console.error('Moderation API request threw:', error)
    return { flagged: false, categories: [] }
  }
}
