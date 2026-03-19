'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data } = await supabase.from('user_profiles').select('is_admin').eq('id', user.id).single()
  if (!data?.is_admin) throw new Error('Forbidden')
  return supabase
}

export async function hideComment(commentId: string) {
  const supabase = await requireAdmin()
  await supabase.from('comments').update({ is_hidden: true }).eq('id', commentId)
  revalidatePath('/admin/moderation')
}

export async function clearFlag(commentId: string) {
  const supabase = await requireAdmin()
  await supabase.from('comments').update({ is_flagged: false }).eq('id', commentId)
  revalidatePath('/admin/moderation')
}
