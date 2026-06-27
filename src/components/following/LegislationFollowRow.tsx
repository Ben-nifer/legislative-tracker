'use client'

import { useState } from 'react'
import Link from 'next/link'
import { updateLegislationNotifySettings, unfollowLegislation } from '@/app/actions/social'

type Props = {
  legislationId: string
  slug: string
  file_number: string
  title: string
  status: string
  notifyUpdates: boolean
  notifyHearings: boolean
  notifyAmendments: boolean
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (val: boolean) => void
  disabled: boolean
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={[
        'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
        checked
          ? 'border-nyc-orange/50 bg-nyc-orange/10 text-nyc-orange'
          : 'border-nyc-border text-nyc-muted hover:border-nyc-border-light hover:text-nyc-blue',
        disabled ? 'opacity-50 cursor-wait' : '',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function statusStyle(status: string) {
  const s = status.toLowerCase()
  if (s.includes('enact') || s.includes('adopt') || s.includes('pass'))
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
  if (s.includes('veto') || s.includes('fail') || s.includes('withdrawn'))
    return 'bg-red-50 text-red-700 border border-red-200'
  if (s.includes('hearing')) return 'bg-blue-50 text-nyc-blue border border-blue-200'
  return 'bg-orange-50 text-orange-700 border border-orange-200'
}

export default function LegislationFollowRow({
  legislationId,
  slug,
  file_number,
  title,
  status,
  notifyUpdates,
  notifyHearings,
  notifyAmendments,
}: Props) {
  const [settings, setSettings] = useState({
    notify_updates: notifyUpdates,
    notify_hearings: notifyHearings,
    notify_amendments: notifyAmendments,
  })
  const [saving, setSaving] = useState(false)
  const [removed, setRemoved] = useState(false)

  async function toggle(key: keyof typeof settings) {
    const next = { ...settings, [key]: !settings[key] }
    setSettings(next)
    setSaving(true)
    const result = await updateLegislationNotifySettings(legislationId, { [key]: next[key] })
    setSaving(false)
    if (result.error) setSettings(settings) // revert
  }

  async function handleUnfollow() {
    setSaving(true)
    const result = await unfollowLegislation(legislationId)
    if (!result.error) setRemoved(true)
    setSaving(false)
  }

  if (removed) return null

  return (
    <div className="rounded border border-nyc-border bg-nyc-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 flex-wrap">
            <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${statusStyle(status)}`}>
              {status}
            </span>
            <span className="font-mono text-xs text-nyc-muted">{file_number}</span>
          </div>
          <Link
            href={`/legislation/${slug}`}
            className="line-clamp-2 text-sm text-nyc-blue hover:text-nyc-orange transition-colors"
          >
            {title}
          </Link>
        </div>
        <button
          onClick={handleUnfollow}
          disabled={saving}
          className="shrink-0 text-xs text-nyc-muted hover:text-red-500 transition-colors"
        >
          Unwatch
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-nyc-muted">Notify me:</span>
        <Toggle
          label="Updates"
          checked={settings.notify_updates}
          onChange={() => toggle('notify_updates')}
          disabled={saving}
        />
        <Toggle
          label="Hearings"
          checked={settings.notify_hearings}
          onChange={() => toggle('notify_hearings')}
          disabled={saving}
        />
        <Toggle
          label="Amendments"
          checked={settings.notify_amendments}
          onChange={() => toggle('notify_amendments')}
          disabled={saving}
        />
      </div>
    </div>
  )
}
