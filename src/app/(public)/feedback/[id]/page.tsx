import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Lightbulb, Bug } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import FeedbackCommentSection from '@/components/feedback/FeedbackCommentSection'
import type { FeedbackComment } from '@/components/feedback/types'

export const revalidate = 0

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: post } = await supabase
    .from('feedback_posts')
    .select('id, type, body, media_url, created_at, user_id')
    .eq('id', id)
    .eq('is_hidden', false)
    .single()

  if (!post) notFound()

  const [commentsRes, authorRes, likesRes, userLikeRes] = await Promise.all([
    supabase
      .from('feedback_comments')
      .select('id, body, created_at, user_id')
      .eq('post_id', id)
      .eq('is_hidden', false)
      .order('created_at', { ascending: true }),
    post.user_id
      ? supabase
          .from('user_profiles')
          .select('username, display_name')
          .eq('id', post.user_id)
          .single()
      : Promise.resolve({ data: null }),
    supabase.from('feedback_likes').select('user_id').eq('post_id', id),
    user
      ? supabase
          .from('feedback_likes')
          .select('user_id')
          .eq('post_id', id)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const comments = commentsRes.data ?? []
  const commentUserIds = [
    ...new Set(comments.map((c) => c.user_id).filter(Boolean) as string[]),
  ]

  const commentProfilesRes =
    commentUserIds.length > 0
      ? await supabase
          .from('user_profiles')
          .select('id, username, display_name')
          .in('id', commentUserIds)
      : { data: [] as { id: string; username: string; display_name: string }[] }

  const profileMap = new Map<string, { username: string; display_name: string }>()
  for (const p of commentProfilesRes.data ?? []) {
    profileMap.set(p.id, { username: p.username, display_name: p.display_name })
  }

  const enrichedComments: FeedbackComment[] = comments.map((c) => ({
    id: c.id,
    body: c.body,
    created_at: c.created_at,
    user_id: c.user_id,
    author: c.user_id ? (profileMap.get(c.user_id) ?? null) : null,
  }))

  const likeCount = (likesRes.data ?? []).length
  const isLiked = !!userLikeRes.data
  const isFeature = post.type === 'feature'
  const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true })
  const author = authorRes.data

  return (
    <main className="min-h-screen bg-nyc-bg">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Back */}
        <Link
          href="/feedback"
          className="mb-6 inline-flex items-center gap-2 text-sm text-nyc-muted-light transition-colors hover:text-white"
        >
          <ArrowLeft size={15} />
          Back to Feedback
        </Link>

        {/* Post */}
        <div className="rounded-xl border border-nyc-border bg-nyc-card shadow-sm">
          <div className="p-6">
            {/* Header */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <span
                className={[
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold',
                  isFeature
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-red-100 text-red-700',
                ].join(' ')}
              >
                {isFeature ? <Lightbulb size={12} /> : <Bug size={12} />}
                {isFeature ? 'Feature Request' : 'Bug Report'}
              </span>
              <span className="text-xs text-nyc-muted/70">{timeAgo}</span>
            </div>

            {/* Body */}
            <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-nyc-blue">
              {post.body}
            </p>

            {/* Image */}
            {post.media_url && (
              <div className="mb-4 overflow-hidden rounded-lg border border-nyc-border">
                <Image
                  src={post.media_url}
                  alt="Screenshot"
                  width={800}
                  height={450}
                  className="w-full object-contain"
                  unoptimized
                />
              </div>
            )}
          </div>

          {/* Author footer */}
          <div className="border-t border-nyc-border px-6 py-4">
            <span className="text-xs text-nyc-muted">
              Posted by{' '}
              {author ? (
                <Link
                  href={`/users/${author.username}`}
                  className="font-medium hover:text-nyc-blue transition-colors"
                >
                  {author.display_name}
                </Link>
              ) : (
                'Anonymous'
              )}
            </span>
          </div>
        </div>

        {/* Likes + Comments */}
        <div className="mt-8">
          <FeedbackCommentSection
            postId={id}
            initialComments={enrichedComments}
            currentUserId={user?.id ?? null}
            initialLikeCount={likeCount}
            isLiked={isLiked}
          />
        </div>
      </div>
    </main>
  )
}
