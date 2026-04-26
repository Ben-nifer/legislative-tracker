import { createServerSupabaseClient } from '@/lib/supabase/server'
import CommentSection from './CommentSection'
import { type CommentData } from './CommentItem'

type RawComment = {
  id: string
  body: string
  created_at: string
  stance_context: 'support' | 'oppose' | 'neutral' | null
  parent_comment_id: string | null
  user_profiles: { username: string; display_name: string } | null
  comment_votes: { vote: number; user_id: string }[]
}

export default async function CommentThread({
  legislationId,
}: {
  legislationId: string
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: raw } = await supabase
    .from('comments')
    .select(`
      id,
      body,
      created_at,
      stance_context,
      parent_comment_id,
      user_profiles(username, display_name),
      comment_votes(vote, user_id)
    `)
    .eq('legislation_id', legislationId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: true })

  const rows = (raw ?? []) as unknown as RawComment[]

  // Build enriched flat list
  const byId = new Map<string, CommentData & { _parentId: string | null }>()
  for (const r of rows) {
    const votes = r.comment_votes ?? []
    const voteScore = votes.reduce((sum, v) => sum + v.vote, 0)
    const userVoteRow = user ? votes.find((v) => v.user_id === user.id) : null
    const profile = Array.isArray(r.user_profiles) ? r.user_profiles[0] : r.user_profiles
    byId.set(r.id, {
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      stance_context: r.stance_context,
      vote_score: voteScore,
      user_vote: userVoteRow ? (userVoteRow.vote as 1 | -1) : null,
      author: {
        username: profile?.username ?? 'unknown',
        display_name: profile?.display_name ?? 'Unknown User',
      },
      replies: [],
      _parentId: r.parent_comment_id,
    })
  }

  // Build tree
  const topLevel: CommentData[] = []
  for (const comment of byId.values()) {
    if (!comment._parentId) {
      topLevel.push(comment)
    } else {
      const parent = byId.get(comment._parentId)
      if (parent) {
        parent.replies.push(comment)
      } else {
        topLevel.push(comment)
      }
    }
  }

  // Sort replies oldest-first within each parent
  for (const c of topLevel) {
    c.replies.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }
  // Top-level default: newest first
  topLevel.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <CommentSection
      legislationId={legislationId}
      initialComments={topLevel}
      isLoggedIn={!!user}
    />
  )
}
