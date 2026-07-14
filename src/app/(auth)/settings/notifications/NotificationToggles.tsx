'use client'

import { useState } from 'react'
import { updateNotificationPreferences } from '@/app/actions/profile'

type Prefs = {
  hearing_alerts: boolean
  bill_updates: boolean
  comment_engagement: boolean
  new_followers: boolean
}

function Toggle({
  enabled,
  pending,
  onToggle,
  label,
}: {
  enabled: boolean
  pending: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      onClick={onToggle}
      disabled={pending}
      aria-pressed={enabled}
      aria-label={label}
      className={[
        'relative h-6 w-11 shrink-0 rounded-full border-2 transition-colors duration-200',
        enabled ? 'border-indigo-500 bg-indigo-500' : 'border-slate-600 bg-slate-700',
        pending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
          enabled ? 'left-[18px]' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  )
}

export default function NotificationToggles({ initialPrefs }: { initialPrefs: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(key: keyof Prefs) {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    setPending(true)
    setError(null)
    const result = await updateNotificationPreferences(next)
    setPending(false)
    if (result.error) {
      setPrefs(prefs) // revert
      setError(result.error)
    }
  }

  const rows: { key: keyof Prefs; label: string; description: string }[] = [
    {
      key: 'hearing_alerts',
      label: 'Hearing alerts',
      description: 'When a bill you follow has a hearing scheduled.',
    },
    {
      key: 'bill_updates',
      label: 'Bill updates',
      description: 'When a bill you follow changes status.',
    },
    {
      key: 'comment_engagement',
      label: 'Comment engagement',
      description: 'When someone replies to or upvotes your comment.',
    },
    {
      key: 'new_followers',
      label: 'New followers',
      description: 'When someone starts following you.',
    },
  ]

  return (
    <>
      {rows.map((row) => (
        <div key={row.key} className="flex items-start justify-between gap-6 p-5">
          <div>
            <p className="font-medium text-nyc-blue">{row.label}</p>
            <p className="mt-1 text-sm text-nyc-muted">{row.description}</p>
          </div>
          <Toggle
            enabled={prefs[row.key]}
            pending={pending}
            onToggle={() => toggle(row.key)}
            label={`Toggle ${row.label}`}
          />
        </div>
      ))}
      {error && <p className="px-5 pb-4 text-xs text-red-400">{error}</p>}
    </>
  )
}
