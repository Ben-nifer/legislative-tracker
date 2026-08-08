'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Heart, MessageCircle, Lightbulb, Bug, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toggleFeedbackLike, deleteFeedbackPost } from '@/app/actions/feedback'
import { useRouter } from 'next/navigation'
import type { FeedbackPost } from './types'

export default function FeedbackCard({
  post,
  currentUserId,
}: {
  post: FeedbackPost
  currentUserId: string | null
}) {
  const router = useRouter()
  const [liked, setLiked] = useState(post.isLiked)
  const [likeCount, setLikeCount] = useState(post.likeCount)
  const [likePending, setLikePending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const isFeature = post.type === 'feature'
  const isOwner = currentUserId === post.user_id
  const isLong = post.body.length > 240
  const displayBody = isLong && !expanded ? post.body.slice(0, 240) + '…' : post.body

  const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true })

  async function handleLike(e: React.MouseEvent) {
    e.preventDefault()
    if (!currentUserId) { router.push('/login'); return }
    if (likePending) return
    const wasLiked = liked
    setLiked(!wasLiked)
    setLikeCount((c) => (wasLiked ? c - 1 : c + 1))
    setLikePending(true)
    const result = await toggleFeedbackLike(post.id, wasLiked)
    setLikePending(false)
    if (result.error) {
      setLiked(wasLiked)
      setLikeCount((c) => (wasLiked ? c + 1 : c - 1))
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    if (!confirm('Delete this feedback?')) return
    setDeleting(true)
    await deleteFeedbackPost(post.id)
    router.refresh()
  }

  return (
    <div className="group rounded-xl border border-nyc-border bg-nyc-card shadow-sm transition-shadow hover:shadow-md">
      <div className="p-5">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <span
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold',
              isFeature
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-red-100 text-red-700',
            ].join(' ')}
          >
            {isFeature ? <Lightbulb size={11} /> : <Bug size={11} />}
            {isFeature ? 'Feature Request' : 'Bug Report'}
          </span>
          <span className="text-xs text-nyc-muted/70">{timeAgo}</span>
        </div>

        {/* Body */}
        <p className="mb-1 text-sm leading-relaxed text-nyc-blue">
          {displayBody}
        </p>
        {isLong && (
          <button
            onClick={(e) => { e.preventDefault(); setExpanded(!expanded) }}
            className="mb-3 text-xs font-medium text-nyc-orange hover:underline"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}

        {/* Image */}
        {post.media_url && (
          <Link href={`/feedback/${post.id}`} className="mb-3 block overflow-hidden rounded-lg border border-nyc-border">
            <Image
              src={post.media_url}
              alt="Screenshot"
              width={600}
              height={300}
              className="max-h-44 w-full object-cover transition-opacity hover:opacity-90"
              unoptimized
            />
          </Link>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-nyc-border px-5 py-3">
        <span className="text-xs text-nyc-muted">
          {post.author ? (
            <Link
              href={`/users/${post.author.username}`}
              className="font-medium hover:text-nyc-blue transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {post.author.display_name}
            </Link>
          ) : (
            'Anonymous'
          )}
        </span>

        <div className="flex items-center gap-3">
          {isOwner && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-nyc-muted/50 transition-colors hover:text-red-500"
              aria-label="Delete post"
            >
              <Trash2 size={13} />
            </button>
          )}

          <Link
            href={`/feedback/${post.id}`}
            className="flex items-center gap-1 text-xs text-nyc-muted transition-colors hover:text-nyc-blue"
          >
            <MessageCircle size={14} />
            <span>{post.commentCount}</span>
          </Link>

          <button
            onClick={handleLike}
            disabled={likePending}
            className={[
              'flex items-center gap-1 text-xs font-medium transition-colors',
              liked ? 'text-red-500' : 'text-nyc-muted hover:text-red-400',
            ].join(' ')}
            aria-label={liked ? 'Unlike' : 'Like'}
          >
            <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
            <span>{likeCount}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
