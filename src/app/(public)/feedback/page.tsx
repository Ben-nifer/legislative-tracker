import { createServerSupabaseClient } from '@/lib/supabase/server'
import { MessageSquarePlus } from 'lucide-react'
import FeedbackForm from '@/components/feedback/FeedbackForm'
import FeedbackFeed from '@/components/feedback/FeedbackFeed'
import type { FeedbackPost } from '@/components/feedback/types'

export const metadata = {
  title: 'Feedback | NYC Legislative Tracker',
  description: 'Share feature requests and bug reports for NYC Legislative Tracker.',
}

export const revalidate = 0

export default async function FeedbackPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: rawPosts } = await supabase
    .from('feedback_posts')
    .select('id, type, body, media_url, created_at, user_id')
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })

  const posts = rawPosts ?? []
  const postIds = posts.map((p) => p.id)
  const userIds = [
    ...new Set(posts.map((p) => p.user_id).filter(Boolean) as string[]),
  ]

  const [likesRes, commentsRes, profilesRes, userLikesRes] = await Promise.all([
    postIds.length > 0
      ? supabase.from('feedback_likes').select('post_id').in('post_id', postIds)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
    postIds.length > 0
      ? supabase.from('feedback_comments').select('post_id').in('post_id', postIds)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
    userIds.length > 0
      ? supabase
          .from('user_profiles')
          .select('id, username, display_name')
          .in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; username: string; display_name: string }[] }),
    user && postIds.length > 0
      ? supabase
          .from('feedback_likes')
          .select('post_id')
          .eq('user_id', user.id)
          .in('post_id', postIds)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
  ])

  const likesByPost = new Map<string, number>()
  for (const like of likesRes.data ?? []) {
    likesByPost.set(like.post_id, (likesByPost.get(like.post_id) ?? 0) + 1)
  }

  const commentsByPost = new Map<string, number>()
  for (const comment of commentsRes.data ?? []) {
    commentsByPost.set(comment.post_id, (commentsByPost.get(comment.post_id) ?? 0) + 1)
  }

  const profileMap = new Map<string, { username: string; display_name: string }>()
  for (const p of profilesRes.data ?? []) {
    profileMap.set(p.id, { username: p.username, display_name: p.display_name })
  }

  const likedPostIds = new Set((userLikesRes.data ?? []).map((l) => l.post_id))

  const feedPosts: FeedbackPost[] = posts.map((p) => ({
    id: p.id,
    type: p.type as 'feature' | 'bug',
    body: p.body,
    media_url: p.media_url,
    created_at: p.created_at,
    user_id: p.user_id,
    likeCount: likesByPost.get(p.id) ?? 0,
    commentCount: commentsByPost.get(p.id) ?? 0,
    isLiked: likedPostIds.has(p.id),
    author: p.user_id ? (profileMap.get(p.user_id) ?? null) : null,
  }))

  return (
    <main className="min-h-screen bg-nyc-bg">
      {/* Hero */}
      <div className="border-b border-white/10 bg-nyc-blue px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-start gap-4">
            <MessageSquarePlus
              className="mt-1 shrink-0 text-nyc-orange"
              size={32}
            />
            <div>
              <h1 className="text-2xl font-black uppercase tracking-widest text-white sm:text-3xl">
                Help Shape{' '}
                <span className="text-nyc-orange">[NYC Legislative Tracker]</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-blue-200 sm:text-base">
                Our goal is to make it as useful as possible for New Yorkers to engage with local
                politics. Let us know what features you&apos;d like to see, bugs you&apos;ve
                spotted, or any other suggestions. And please help us come up with a better name!!
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          {/* Left: Submission form (sticky on desktop) */}
          <div className="w-full shrink-0 lg:sticky lg:top-20 lg:w-80">
            <FeedbackForm userId={user?.id ?? null} />
          </div>

          {/* Right: Sortable feed */}
          <div className="min-w-0 flex-1">
            <FeedbackFeed posts={feedPosts} currentUserId={user?.id ?? null} />
          </div>
        </div>
      </div>
    </main>
  )
}
