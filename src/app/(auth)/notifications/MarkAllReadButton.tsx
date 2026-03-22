'use client'

import { useState } from 'react'
import { CheckCheck } from 'lucide-react'
import { markAllRead } from '@/app/actions/notifications'

export default function MarkAllReadButton({ hasUnread }: { hasUnread: boolean }) {
  const [pending, setPending] = useState(false)

  if (!hasUnread) return null

  async function handleClick() {
    if (pending) return
    setPending(true)
    await markAllRead()
    setPending(false)
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-50"
    >
      <CheckCheck size={13} />
      Mark all as read
    </button>
  )
}
