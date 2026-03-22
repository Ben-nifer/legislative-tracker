import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Bell, UserPlus, MessageSquare } from 'lucide-react'
import MarkAllReadButton from './MarkAllReadButton'

export const metadata = {
  title: 'Notifications | NYC Legislative Tracker',
}

export const revalidate = 0

type NotificationType = 'new_follower' | 'comment_reply' | 'comment_upvote' | string

function NotificationIcon({ type }: { type: NotificationType }) {
  if (type === 'new_follower')
    return <UserPlus size={16} className="text-indigo-400 shrink-0" />
  if (type === 'comment_reply' || type === 'comment_upvote')
    return <MessageSquare size={16} className="text-purple-400 shrink-0" />
  return <Bell size={16} className="text-slate-400 shrink-0" />
}

export default async function NotificationsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/notifications')

  // Mark all read on page load (clears the badge) — done directly to avoid
  // calling revalidatePath during render, which Next.js disallows.
  await supabase
    .from('notifications')
    .update({ read: true })
    .match({ user_id: user.id, read: false })

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, type, title, body, url, read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const items = notifications ?? []
  const hasUnread = items.some((n) => !n.read)

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={20} className="text-indigo-400" />
            <h1 className="text-2xl font-bold text-white">Notifications</h1>
          </div>
          <MarkAllReadButton hasUnread={hasUnread} />
        </div>

        {/* List */}
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-16 text-center">
            <Bell size={32} className="mx-auto mb-3 text-slate-700" />
            <p className="text-sm text-slate-500">No notifications yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((n) => {
              const inner = (
                <div className={[
                  'flex items-start gap-3 rounded-xl border p-4 transition-colors',
                  !n.read
                    ? 'border-indigo-500/30 bg-indigo-500/5'
                    : 'border-slate-800 bg-slate-900/60',
                  n.url ? 'hover:border-slate-700 hover:bg-slate-800/60' : '',
                ].join(' ')}>
                  {/* Unread dot */}
                  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    {!n.read && (
                      <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    )}
                  </div>

                  <NotificationIcon type={n.type} />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-100">{n.title}</p>
                    {n.body && (
                      <p className="mt-0.5 text-sm text-slate-400">{n.body}</p>
                    )}
                    <p className="mt-1.5 text-xs text-slate-600">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              )

              return n.url ? (
                <Link key={n.id} href={n.url}>{inner}</Link>
              ) : (
                <div key={n.id}>{inner}</div>
              )
            })}
          </div>
        )}

      </div>
    </main>
  )
}
