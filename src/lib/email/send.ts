import { Resend } from 'resend'

// Lazy-initialize so the build doesn't fail when RESEND_API_KEY isn't set
let _resend: Resend | null = null
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

// The "from" address must be a verified domain in your Resend account.
// During development you can use: onboarding@resend.dev (sends to your account email only)
const FROM = process.env.EMAIL_FROM ?? 'NYC Legislative Tracker <onboarding@resend.dev>'

export type DigestItem = {
  file_number: string
  title: string
  status: string
  slug: string
  last_action_text: string | null
  last_action_date: string | null
}

/**
 * Send a daily digest email to a single user.
 */
export async function sendDigestEmail({
  to,
  displayName,
  items,
}: {
  to: string
  displayName: string | null
  items: DigestItem[]
}): Promise<{ error?: string }> {
  const name = displayName ?? 'there'
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000'

  const itemRows = items
    .map(
      (item) => `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #1e293b;">
          <a href="${baseUrl}/legislation/${item.slug}"
             style="color: #818cf8; text-decoration: none; font-weight: 600; font-size: 14px;">
            ${item.file_number} — ${item.title}
          </a>
          <div style="margin-top: 4px; font-size: 12px; color: #94a3b8;">
            Status: ${item.status}
            ${item.last_action_text ? `&nbsp;·&nbsp;${item.last_action_text}` : ''}
            ${item.last_action_date ? `&nbsp;·&nbsp;${new Date(item.last_action_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
          </div>
        </td>
      </tr>`
    )
    .join('')

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 16px;">

    <!-- Header -->
    <div style="margin-bottom: 24px;">
      <span style="color: #818cf8; font-size: 13px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">
        NYC Legislative Tracker
      </span>
      <h1 style="margin: 8px 0 0; color: #f1f5f9; font-size: 22px; font-weight: 700;">
        Your daily digest
      </h1>
      <p style="margin: 6px 0 0; color: #94a3b8; font-size: 14px;">
        Hi ${name}, here's what's been happening with legislation you follow.
      </p>
    </div>

    <!-- Items -->
    <div style="background: #1e293b; border-radius: 12px; border: 1px solid #334155; padding: 0 16px;">
      <table style="width: 100%; border-collapse: collapse;">
        ${itemRows}
      </table>
    </div>

    <!-- Footer -->
    <div style="margin-top: 24px; text-align: center;">
      <a href="${baseUrl}/legislation"
         style="display: inline-block; background: #6366f1; color: #fff; text-decoration: none;
                padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">
        Browse all legislation
      </a>
      <p style="margin-top: 16px; font-size: 11px; color: #475569;">
        You're receiving this because you enabled daily digests.
        <a href="${baseUrl}/settings/notifications" style="color: #64748b;">Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>`

  const { error } = await getResend().emails.send({
    from: FROM,
    to,
    subject: `Your NYC Legislative Tracker digest — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
    html,
  })

  if (error) return { error: error.message }
  return {}
}
