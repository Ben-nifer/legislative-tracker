'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { addComment } from '@/app/actions/comments'
import CommentItem, { type CommentData } from './CommentItem'

type Sort = 'latest' | 'most_liked'

export default function CommentSection({
  legislationId,
  initialComments,
  isLoggedIn,
}: {
  legislationId: string
  initialComments: CommentData[]
  isLoggedIn: boolean
}) {
  const router = useRouter()
  const [comments, setComments] = useState<CommentData[]>(initialComments)

  const [sort, setSort] = useState<Sort>('latest')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const MAX = 2000

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || loading) return
    setLoading(true)
    setError(null)
    const result = await addComment(legislationId, body.trim())
    setLoading(false)
    if (result.error) {
      setError(result.error)
    } else if (result.comment) {
      setComments((prev) => [
        { ...result.comment!, vote_score: 0, user_vote: null, replies: [] },
        ...prev,
      ])
      setBody('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      router.refresh()
    }
  }

  async function handleReply(parentId: string, replyBody: string): Promise<string | undefined> {
    const result = await addComment(legislationId, replyBody, parentId)
    if (result.error) return result.error
    if (result.comment) {
      setComments((prev) =>
        prev.map((c) =>
          c.id === parentId
            ? { ...c, replies: [...c.replies, { ...result.comment!, vote_score: 0, user_vote: null, replies: [] }] }
            : c
        )
      )
      router.refresh()
    }
    return undefined
  }

  const sorted = useMemo(() => {
    const list = [...comments]
    if (sort === 'most_liked') {
      list.sort((a, b) => b.vote_score - a.vote_score)
    } else {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
    return list
  }, [comments, sort])

  const totalCount = comments.reduce((n, c) => n + 1 + c.replies.length, 0)

  return (
    <section id="comments" className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          <MessageSquare size={14} />
          Discussion
          {totalCount > 0 && (
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs normal-case text-slate-300">
              {totalCount}
            </span>
          )}
        </h2>

        {totalCount > 1 && (
          <div className="flex gap-1">
            {([
              { value: 'latest' as Sort, label: 'Latest' },
              { value: 'most_liked' as Sort, label: 'Most Liked' },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSort(opt.value)}
                className={[
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  sort === opt.value
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compose */}
      {isLoggedIn ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => { setBody(e.target.value); autoResize() }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit(e as any)
            }}
            placeholder="Share your thoughts on this legislation…"
            rows={3}
            maxLength={MAX}
            className="w-full resize-none overflow-hidden rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between">
            <span className={`text-xs ${body.length > MAX * 0.9 ? 'text-amber-400' : 'text-slate-600'}`}>
              {body.length > 0 ? `${body.length}/${MAX} · ⌘↵ to post` : ''}
            </span>
            <button
              type="submit"
              disabled={loading || !body.trim()}
              className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-400">
          <Link href="/login" className="text-indigo-400 hover:underline">Sign in</Link>{' '}
          to join the discussion.
        </div>
      )}

      {/* Comment list */}
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-600">
          No comments yet — be the first to share your thoughts.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              legislationId={legislationId}
              isLoggedIn={isLoggedIn}
              onReply={handleReply}
            />
          ))}
        </div>
      )}
    </section>
  )
}
