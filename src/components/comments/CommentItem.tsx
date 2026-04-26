'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Flag, ThumbsUp, ThumbsDown, Minus, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import VoteButtons from './VoteButtons'
import { reportComment } from '@/app/actions/comments'

export type CommentData = {
  id: string
  body: string
  created_at: string
  stance_context: 'support' | 'oppose' | 'neutral' | null
  vote_score: number
  user_vote: 1 | -1 | null
  author: {
    username: string
    display_name: string
  }
  replies: CommentData[]
}

const STANCE_CONFIG = {
  support:  { label: 'Support',  icon: <ThumbsUp  size={10} />, style: 'bg-emerald-500/20 text-emerald-300' },
  oppose:   { label: 'Oppose',   icon: <ThumbsDown size={10} />, style: 'bg-red-500/20 text-red-300' },
  neutral:  { label: 'Neutral',  icon: <Minus      size={10} />, style: 'bg-amber-500/20 text-amber-300' },
}

export default function CommentItem({
  comment,
  legislationId,
  isLoggedIn,
  onReply,
  depth = 0,
}: {
  comment: CommentData
  legislationId: string
  isLoggedIn: boolean
  onReply: (parentId: string, body: string) => Promise<string | undefined>
  depth?: number
}) {
  const [showReply, setShowReply] = useState(false)
  const [showReplies, setShowReplies] = useState(true)
  const [replyBody, setReplyBody] = useState('')
  const [replyLoading, setReplyLoading] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [reported, setReported] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  async function handleReport() {
    if (reported) return
    await reportComment(comment.id)
    setReported(true)
  }

  async function handleReplySubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!replyBody.trim() || replyLoading) return
    setReplyLoading(true)
    setReplyError(null)
    const err = await onReply(comment.id, replyBody.trim())
    setReplyLoading(false)
    if (err) {
      setReplyError(err)
    } else {
      setReplyBody('')
      setShowReply(false)
      setShowReplies(true)
    }
  }

  const initials = comment.author.display_name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const stance = comment.stance_context ? STANCE_CONFIG[comment.stance_context] : null

  // Top-level gets card styling; replies stay minimal
  const isTopLevel = depth === 0

  return (
    <div className={isTopLevel ? 'rounded-lg border border-slate-700/50 bg-slate-900/40' : ''}>
      <div className="group flex gap-3 p-3">
        {/* Thread collapse line for top-level */}
        {isTopLevel ? (
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex flex-col items-center gap-1 shrink-0"
            title={collapsed ? 'Expand thread' : 'Collapse thread'}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-300">
              {initials}
            </div>
            {!collapsed && (
              <div className="w-0.5 flex-1 min-h-[8px] rounded-full bg-slate-700 hover:bg-indigo-500/50 transition-colors" />
            )}
          </button>
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700/50 text-xs font-semibold text-slate-400">
            {initials}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
            <Link
              href={`/users/${comment.author.username}`}
              className="text-sm font-medium text-slate-200 hover:text-indigo-400 transition-colors"
            >
              {comment.author.display_name}
            </Link>
            <span className="text-xs text-slate-600">@{comment.author.username}</span>

            {stance && (
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${stance.style}`}>
                {stance.icon}
                {stance.label}
              </span>
            )}

            <span className="ml-auto text-xs text-slate-600" title={new Date(comment.created_at).toLocaleString()}>
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
          </div>

          {/* Collapsed preview */}
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors italic"
            >
              Comment collapsed — click to expand
            </button>
          ) : (
            <>
              {/* Body */}
              <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-wrap break-words">
                {comment.body}
              </p>

              {/* Action bar */}
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <VoteButtons
                  commentId={comment.id}
                  initialScore={comment.vote_score}
                  initialUserVote={comment.user_vote}
                  isLoggedIn={isLoggedIn}
                />

                {isLoggedIn && (
                  <button
                    onClick={() => setShowReply((v) => !v)}
                    className={[
                      'flex items-center gap-1 text-xs transition-colors',
                      showReply ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300',
                    ].join(' ')}
                  >
                    <MessageSquare size={13} />
                    {showReply ? 'Cancel' : 'Reply'}
                  </button>
                )}

                {comment.replies.length > 0 && (
                  <button
                    onClick={() => setShowReplies((v) => !v)}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showReplies
                      ? `Hide ${comment.replies.length} ${comment.replies.length === 1 ? 'reply' : 'replies'}`
                      : `${comment.replies.length} ${comment.replies.length === 1 ? 'reply' : 'replies'}`}
                  </button>
                )}

                <div className="ml-auto">
                  {!reported ? (
                    <button
                      onClick={handleReport}
                      className="flex items-center gap-1 text-xs text-slate-700 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-500"
                    >
                      <Flag size={11} /> Report
                    </button>
                  ) : (
                    <span className="text-xs text-slate-600">Reported</span>
                  )}
                </div>
              </div>

              {/* Inline reply form */}
              {showReply && (
                <form onSubmit={handleReplySubmit} className="mt-3 space-y-2">
                  <textarea
                    value={replyBody}
                    onChange={(e) => {
                      setReplyBody(e.target.value)
                      e.target.style.height = 'auto'
                      e.target.style.height = e.target.scrollHeight + 'px'
                    }}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleReplySubmit(e as any)
                    }}
                    placeholder={`Replying to @${comment.author.username}…`}
                    rows={2}
                    maxLength={2000}
                    autoFocus
                    className="w-full resize-none overflow-hidden rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-600">{replyBody.length}/2000 · ⌘↵ to post</p>
                    <div className="flex items-center gap-2">
                      {replyError && <p className="text-xs text-red-400">{replyError}</p>}
                      <button
                        type="button"
                        onClick={() => { setShowReply(false); setReplyBody('') }}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={replyLoading || !replyBody.trim()}
                        className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                      >
                        {replyLoading ? 'Posting…' : 'Reply'}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {/* Replies */}
      {!collapsed && showReplies && comment.replies.length > 0 && (
        <div className="border-t border-slate-700/40 px-3 pb-3 space-y-0 divide-y divide-slate-700/30">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="pt-3">
              <CommentItem
                comment={reply}
                legislationId={legislationId}
                isLoggedIn={isLoggedIn}
                onReply={onReply}
                depth={depth + 1}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
