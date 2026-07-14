'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Flag, ThumbsUp, ThumbsDown, Minus, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import VoteButtons from './VoteButtons'
import { reportComment, editComment, deleteComment } from '@/app/actions/comments'

export type CommentData = {
  id: string
  body: string
  created_at: string
  updated_at: string
  stance_context: 'support' | 'oppose' | 'neutral' | null
  vote_score: number
  user_vote: 1 | -1 | null
  isOwn: boolean
  author: {
    username: string
    display_name: string
  }
  replies: CommentData[]
}

const STANCE_CONFIG = {
  support:  { label: 'Support',  icon: <ThumbsUp  size={10} />, style: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  oppose:   { label: 'Oppose',   icon: <ThumbsDown size={10} />, style: 'bg-red-50 text-red-700 border border-red-200' },
  neutral:  { label: 'Neutral',  icon: <Minus      size={10} />, style: 'bg-amber-50 text-amber-700 border border-amber-200' },
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
  const router = useRouter()
  const [showReply, setShowReply] = useState(false)
  const [showReplies, setShowReplies] = useState(true)
  const [replyBody, setReplyBody] = useState('')
  const [replyLoading, setReplyLoading] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [reported, setReported] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const [localBody, setLocalBody] = useState(comment.body)
  const [isEdited, setIsEdited] = useState(comment.updated_at !== comment.created_at)
  const [showEdit, setShowEdit] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  async function handleReport() {
    if (reported) return
    await reportComment(comment.id)
    setReported(true)
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editBody.trim() || editLoading) return
    setEditLoading(true)
    setEditError(null)
    const result = await editComment(comment.id, editBody.trim())
    setEditLoading(false)
    if (result.error) {
      setEditError(result.error)
    } else {
      setLocalBody(editBody.trim())
      setIsEdited(true)
      setShowEdit(false)
      router.refresh()
    }
  }

  async function handleDelete() {
    if (deleteLoading) return
    setDeleteLoading(true)
    const result = await deleteComment(comment.id)
    if (result.error) {
      setDeleteLoading(false)
    } else {
      setDeleted(true)
      router.refresh()
    }
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

  if (deleted) return null

  const initials = comment.author.display_name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const stance = comment.stance_context ? STANCE_CONFIG[comment.stance_context] : null

  const isTopLevel = depth === 0

  return (
    <div id={`comment-${comment.id}`} className={isTopLevel ? 'rounded border border-nyc-border bg-nyc-card-hover' : ''}>
      <div className="group flex gap-3 p-3">
        {/* Thread collapse line for top-level */}
        {isTopLevel ? (
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex flex-col items-center gap-1 shrink-0"
            title={collapsed ? 'Expand thread' : 'Collapse thread'}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-nyc-blue/10 text-xs font-semibold text-nyc-blue">
              {initials}
            </div>
            {!collapsed && (
              <div className="w-0.5 flex-1 min-h-[8px] rounded-full bg-nyc-border hover:bg-nyc-orange/40 transition-colors" />
            )}
          </button>
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-nyc-muted/10 text-xs font-semibold text-nyc-muted">
            {initials}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
            <Link
              href={`/users/${comment.author.username}`}
              className="text-sm font-medium text-nyc-blue hover:text-nyc-orange transition-colors"
            >
              {comment.author.display_name}
            </Link>
            <span className="text-xs text-nyc-muted">@{comment.author.username}</span>

            {stance && (
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${stance.style}`}>
                {stance.icon}
                {stance.label}
              </span>
            )}

            <span className="ml-auto text-xs text-nyc-muted/60" title={new Date(comment.created_at).toLocaleString()}>
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
          </div>

          {/* Collapsed preview */}
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="text-xs text-nyc-muted hover:text-nyc-blue transition-colors italic"
            >
              Comment collapsed — click to expand
            </button>
          ) : (
            <>
              {/* Body */}
              {showEdit ? (
                <form onSubmit={handleEditSubmit} className="space-y-2">
                  <textarea
                    value={editBody}
                    onChange={(e) => {
                      setEditBody(e.target.value)
                      e.target.style.height = 'auto'
                      e.target.style.height = e.target.scrollHeight + 'px'
                    }}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleEditSubmit(e as any)
                    }}
                    rows={3}
                    maxLength={2000}
                    autoFocus
                    className="w-full resize-none overflow-hidden rounded border border-nyc-border bg-nyc-card px-3 py-2 text-sm text-nyc-blue placeholder-nyc-muted focus:border-nyc-orange focus:outline-none focus:ring-1 focus:ring-nyc-orange/30 transition-colors"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-nyc-muted/60">{editBody.length}/2000 · ⌘↵ to save</p>
                    <div className="flex items-center gap-2">
                      {editError && <p className="text-xs text-red-500">{editError}</p>}
                      <button
                        type="button"
                        onClick={() => { setShowEdit(false); setEditBody(localBody); setEditError(null) }}
                        className="text-xs text-nyc-muted hover:text-nyc-blue transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={editLoading || !editBody.trim()}
                        className="rounded bg-nyc-orange px-3 py-1 text-xs font-medium text-white hover:bg-nyc-orange-hover disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                      >
                        {editLoading ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <p className="text-sm leading-relaxed text-nyc-blue whitespace-pre-wrap break-words">
                  {localBody}
                  {isEdited && (
                    <span className="ml-1.5 text-xs text-nyc-muted/50">(edited)</span>
                  )}
                </p>
              )}

              {/* Action bar */}
              {!showEdit && (
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
                      showReply ? 'text-nyc-orange' : 'text-nyc-muted hover:text-nyc-blue',
                    ].join(' ')}
                  >
                    <MessageSquare size={13} />
                    {showReply ? 'Cancel' : 'Reply'}
                  </button>
                )}

                {comment.replies.length > 0 && (
                  <button
                    onClick={() => setShowReplies((v) => !v)}
                    className="text-xs text-nyc-muted hover:text-nyc-blue transition-colors"
                  >
                    {showReplies
                      ? `Hide ${comment.replies.length} ${comment.replies.length === 1 ? 'reply' : 'replies'}`
                      : `${comment.replies.length} ${comment.replies.length === 1 ? 'reply' : 'replies'}`}
                  </button>
                )}

                <div className="ml-auto flex items-center gap-3">
                  {comment.isOwn && (
                    <>
                      <button
                        onClick={() => { setShowEdit(true); setEditBody(localBody) }}
                        className="flex items-center gap-1 text-xs text-nyc-muted/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-nyc-blue"
                      >
                        <Pencil size={11} /> Edit
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={deleteLoading}
                        className="flex items-center gap-1 text-xs text-nyc-muted/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={11} /> {deleteLoading ? 'Deleting…' : 'Delete'}
                      </button>
                    </>
                  )}
                  {!comment.isOwn && (
                    !reported ? (
                      <button
                        onClick={handleReport}
                        className="flex items-center gap-1 text-xs text-nyc-muted/20 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
                      >
                        <Flag size={11} /> Report
                      </button>
                    ) : (
                      <span className="text-xs text-nyc-muted/50">Reported</span>
                    )
                  )}
                </div>
              </div>
              )}

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
                    className="w-full resize-none overflow-hidden rounded border border-nyc-border bg-nyc-card px-3 py-2 text-sm text-nyc-blue placeholder-nyc-muted focus:border-nyc-orange focus:outline-none focus:ring-1 focus:ring-nyc-orange/30 transition-colors"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-nyc-muted/60">{replyBody.length}/2000 · ⌘↵ to post</p>
                    <div className="flex items-center gap-2">
                      {replyError && <p className="text-xs text-red-500">{replyError}</p>}
                      <button
                        type="button"
                        onClick={() => { setShowReply(false); setReplyBody('') }}
                        className="text-xs text-nyc-muted hover:text-nyc-blue transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={replyLoading || !replyBody.trim()}
                        className="rounded bg-nyc-orange px-3 py-1 text-xs font-medium text-white hover:bg-nyc-orange-hover disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
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
        <div className="border-t border-nyc-border/40 px-3 pb-3 space-y-0 divide-y divide-nyc-border/30">
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
