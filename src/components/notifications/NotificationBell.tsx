import Link from 'next/link'
import { Bell } from 'lucide-react'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function NotificationBell() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('read', false)

  const unread = count ?? 0
  const label = unread > 9 ? '9+' : unread > 0 ? String(unread) : null

  return (
    <Link
      href="/notifications"
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
      aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
    >
      <Bell size={18} />
      {label && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
          {label}
        </span>
      )}
    </Link>
  )
}
