import { createServerSupabaseClient } from '@/lib/supabase/server'
import NotificationBellClient from './NotificationBellClient'

export default async function NotificationBell() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('read', false)

  return (
    <NotificationBellClient
      initialCount={count ?? 0}
      userId={user.id}
    />
  )
}
