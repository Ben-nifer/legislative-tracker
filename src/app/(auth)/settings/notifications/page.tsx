import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DigestToggle from './DigestToggle'
import NotificationToggles from './NotificationToggles'
import { Bell } from 'lucide-react'

export const metadata = {
  title: 'Notification Settings | NYC Legislative Tracker',
}

export default async function NotificationSettingsPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/settings/notifications')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('display_name, email_digests_enabled, notification_preferences')
    .eq('id', user.id)
    .single()

  const notifPrefs = {
    hearing_alerts: profile?.notification_preferences?.hearing_alerts ?? true,
    bill_updates: profile?.notification_preferences?.bill_updates ?? true,
    comment_engagement: profile?.notification_preferences?.comment_engagement ?? true,
    new_followers: profile?.notification_preferences?.new_followers ?? true,
  }

  return (
    <main className="min-h-screen bg-nyc-bg">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">

        <div className="mb-8 flex items-center gap-3">
          <Bell className="text-nyc-orange" size={24} />
          <div>
            <h1 className="text-xl font-bold text-white">Notification Settings</h1>
            <p className="text-sm text-nyc-muted-light">Manage how you hear about legislation updates</p>
          </div>
        </div>

        <div className="rounded border border-nyc-border bg-nyc-card divide-y divide-nyc-border">

          {/* In-app notification toggles */}
          <NotificationToggles initialPrefs={notifPrefs} />

          {/* Daily digest row */}
          <div className="flex items-start justify-between gap-6 p-5">
            <div>
              <p className="font-medium text-nyc-blue">Daily email digest</p>
              <p className="mt-1 text-sm text-nyc-muted">
                Get a daily summary of activity on legislation you follow.
                Sent every morning at 9 AM — only when there&apos;s something new.
              </p>
              <p className="mt-1 text-xs text-nyc-muted/60">
                Delivered to: {user.email}
              </p>
            </div>
            <DigestToggle initialEnabled={profile?.email_digests_enabled ?? false} />
          </div>

        </div>

      </div>
    </main>
  )
}
