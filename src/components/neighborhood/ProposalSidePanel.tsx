'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X, MapPin, Route, Hexagon } from 'lucide-react'
import { bookmarkProposal, unbookmarkProposal } from '@/app/actions/proposal-engagement'

export type SidePanelProposal = {
  id: string
  slug: string
  title: string
  summary: string | null
  status: string
  proposal_family: 'ulurp' | 'dot'
  geometry_type: 'point' | 'line' | 'polygon'
}

const GEOMETRY_ICON = {
  point: <MapPin size={13} />,
  line: <Route size={13} />,
  polygon: <Hexagon size={13} />,
}

export default function ProposalSidePanel({
  proposal,
  isLoggedIn,
  onClose,
}: {
  proposal: SidePanelProposal
  isLoggedIn: boolean
  onClose: () => void
}) {
  const [saved, setSaved] = useState(false)
  const [savePending, setSavePending] = useState(false)

  async function handleSave() {
    if (!isLoggedIn || savePending) return
    const prev = saved
    setSaved(!prev)
    setSavePending(true)
    const result = prev ? await unbookmarkProposal(proposal.id) : await bookmarkProposal(proposal.id)
    setSavePending(false)
    if (result.error) setSaved(prev)
  }

  return (
    <div className="absolute right-3 top-3 z-10 w-80 rounded-xl border border-nyc-border bg-nyc-card p-4 shadow-xl">
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 text-nyc-muted hover:text-nyc-blue transition-colors"
      >
        <X size={16} />
      </button>

      <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-nyc-muted">
        {GEOMETRY_ICON[proposal.geometry_type]}
        {proposal.proposal_family === 'ulurp' ? 'ULURP' : 'DOT'} · {proposal.status}
      </span>

      <h3 className="mt-2 pr-5 text-sm font-bold leading-snug text-nyc-blue">
        {proposal.title}
      </h3>

      <p className="mt-2 text-xs leading-relaxed text-nyc-muted">
        {proposal.summary ?? 'No summary available yet.'}
      </p>

      <div className="mt-4 flex gap-2">
        <Link
          href={`/proposals/${proposal.slug}`}
          className="flex-1 rounded bg-nyc-orange px-3 py-1.5 text-center text-xs font-bold text-white transition-colors hover:bg-nyc-orange-hover"
        >
          Learn More
        </Link>
        <button
          onClick={handleSave}
          disabled={!isLoggedIn || savePending}
          className={[
            'rounded border px-3 py-1.5 text-xs font-bold transition-colors',
            !isLoggedIn
              ? 'cursor-not-allowed border-nyc-border/40 text-nyc-muted/30'
              : saved
              ? 'border-nyc-orange/60 bg-nyc-orange/15 text-nyc-orange'
              : 'border-nyc-border-light text-nyc-muted hover:border-nyc-orange/40 hover:text-nyc-orange',
          ].join(' ')}
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
