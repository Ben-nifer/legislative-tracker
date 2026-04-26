'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addComment } from '@/app/actions/comments'

export default function CommentInput({
  legislationId,
  parentCommentId,
  placeholder = 'Share your thoughts on this legislation...',
  onSuccess,
}: {
  legislationId: string
  parentCommentId?: string
  placeholder?: string
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const MAX = 2000

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || loading) return

    setLoading(true)
    setError(null)

    const result = await addComment(legislationId, body, parentCommentId)

    setLoading(false)
    if (result.error) {
      setError(result.error)
    } else {
      setBody('')
      router.refresh()
      onSuccess?.()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={parentCommentId ? 2 : 3}
        maxLength={MAX}
        className="w-full resize-none rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
      />
      <div className="flex items-center justify-between">
        <span className={`text-xs ${body.length > MAX * 0.9 ? 'text-amber-400' : 'text-slate-600'}`}>
          {body.length}/{MAX}
        </span>
        <div className="flex items-center gap-3">
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading || !body.trim()}
            className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Posting...' : parentCommentId ? 'Reply' : 'Comment'}
          </button>
        </div>
      </div>
    </form>
  )
}
