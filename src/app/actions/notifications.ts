'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function markNotificationRead(
  notificationId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .match({ id: notificationId, user_id: user.id })

  if (error) return { error: error.message }

  revalidatePath('/notifications')
  return {}
}

export async function markAllRead(): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .match({ user_id: user.id, read: false })

  if (error) return { error: error.message }

  revalidatePath('/notifications')
  return {}
}
