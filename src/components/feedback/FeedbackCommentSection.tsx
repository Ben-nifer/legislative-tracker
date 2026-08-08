'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Heart, Loader2, Send, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toggleFeedbackLike, addFeedbackComment, deleteFeedbackComment } from '@/app/actions/feedback'
import type { FeedbackComment } from './types'

const MAX_CHARS = 500

export default function FeedbackCommentSection({
  postId,
  initialComments,
  currentUserId,
  initialLikeCount,
  isLiked: initialLiked,
}: {
  postId: string
  initialComments: FeedbackComment[]
  currentUserId: string | null
  initialLikeCount: number
  isLiked: boolean
}) {
  const [comments, setComments] = useState<FeedbackComment[]>(initialComments)
  const [liked, setLiked] = useState(initialLiked)
  const [likeCount, setLikeCount] = useState(initialLikeCount)
  const [likePending, setLikePending] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLike() {
    if (!currentUserId) { window.location.href = '/login'; return }
    if (likePending) return
    const wasLiked = liked
    setLiked(!wasLiked)
    setLikeCount((c) => (wasLiked ? c - 1 : c + 1))
    setLikePending(true)
    const result = await toggleFeedbackLike(postId, wasLiked)
    setLikePending(false)
    if (result.error) {
      setLiked(wasLiked)
      setLikeCount((c) => (wasLiked ? c + 1 : c - 1))
    }
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault()
    if (!commentBody.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    const result = await addFeedbackComment(postId, commentBody)
    setSubmitting(false)
    if (result.error) { setError(result.error); return }
    setComments((prev) => [
      ...prev,
      {
        id: result.id!,
        body: commentBody.trim(),
        created_at: new Date().toISOString(),
        user_id: currentUserId,
        author: null,
      },
    ])
    setCommentBody('')
  }

  async function handleDelete(commentId: string) {
    const result = await deleteFeedbackComment(commentId)
    if (!result.error) {
      setComments((prev) => prev.filter((c) => c.id !== commentId))
    }
  }

  return (
    <div>
      {/* Like button */}
      <div className="mb-8">
        <button
          onClick={handleLike}
          disabled={likePending}
          className={[
            'inline-flex items-center gap-2 rounded-lg border px-5 py-2 text-sm font-bold transition-colors',
            liked
              ? 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100'
              : 'border-nyc-border/50 text-nyc-muted-light hover:border-red-300 hover:text-red-400',
          ].join(' ')}
        >
          <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
          {likeCount} {likeCount === 1 ? 'Like' : 'Likes'}
        </button>
      </div>

      {/* Comments header */}
      <h2 className="mb-4 text-xs font-black uppercase tracking-widest text-nyc-muted-light">
        {comments.length} {comments.length === 1 ? 'Comment' : 'Comments'}
      </h2>

      {/* Comment list */}
      <div className="mb-6 space-y-3">
        {comments.length === 0 && (
          <p className="py-8 text-center text-sm text-nyc-muted-light/50">
            No comments yet. Start the conversation.
          </p>
        )}
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-xl border border-nyc-border bg-nyc-card p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-nyc-muted">
                {comment.author ? (
                  <Link
                    href={`/users/${comment.author.username}`}
                    className="hover:text-nyc-blue transition-colors"
                  >
                    {comment.author.display_name}
                  </Link>
                ) : (
                  'Someone'
                )}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-nyc-muted/50">
                  {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                </span>
                {currentUserId && comment.user_id === currentUserId && (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="text-nyc-muted/40 transition-colors hover:text-red-500"
                    aria-label="Delete comment"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-nyc-blue">{comment.body}</p>
          </div>
        ))}
      </div>

      {/* Comment input */}
      {currentUserId ? (
        <form onSubmit={handleComment} className="space-y-2">
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            maxLength={MAX_CHARS}
            rows={3}
            placeholder="Add a comment..."
            className="w-full resize-none rounded-lg border border-nyc-border bg-nyc-card p-3 text-sm text-nyc-blue placeholder-nyc-muted/40 focus:border-nyc-orange focus:outline-none focus:ring-1 focus:ring-nyc-orange transition-colors"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center justify-between">
            <span className="text-xs text-nyc-muted/50">{commentBody.length}/{MAX_CHARS}</span>
            <button
              type="submit"
              disabled={submitting || !commentBody.trim()}
              className="flex items-center gap-2 rounded-lg bg-nyc-blue px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-nyc-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Comment
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-xl border border-nyc-border/30 bg-nyc-card/5 py-6 text-center">
          <p className="text-sm text-nyc-muted-light">
            <Link href="/login" className="font-bold text-nyc-orange hover:underline">
              Sign in
            </Link>{' '}
            to leave a comment
          </p>
        </div>
      )}
    </div>
  )
}
