'use client'

import { ComingSoonPill } from '../WidgetSection'

// S2 option cards (design export): selected = accent border + soft fill + check;
// levels without data = dashed, disabled, "Coming soon" (build plan B3).
export default function ToggleCard({
  label,
  sub,
  yours,
  selected,
  comingSoon,
  onToggle,
}: {
  label: string
  sub: string
  yours: boolean
  selected: boolean
  comingSoon: boolean
  onToggle: () => void
}) {
  const badge = yours && (
    <span className="rounded-full bg-civic-badge-bg px-2 py-0.5 text-xs font-bold text-civic-badge-ink">Yours</span>
  )
  const text = (
    <div className="flex flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[17px] font-semibold">{label}</span>
        {badge}
      </div>
      <span className="text-[13px] text-civic-muted lg:text-sm">{sub}</span>
    </div>
  )

  if (comingSoon) {
    return (
      <div aria-disabled="true" className="flex items-center gap-3.5 rounded-[14px] border-[1.5px] border-dashed border-civic-dash bg-civic-sunken px-4 py-3.5 text-civic-muted lg:px-[18px] lg:py-4">
        {text}
        <span className="flex-none"><ComingSoonPill /></span>
      </div>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`flex items-center gap-3.5 rounded-[14px] border-[1.5px] px-4 py-3.5 text-left text-civic-ink lg:px-[18px] lg:py-4 ${
        selected ? 'border-civic-accent bg-civic-accent-soft' : 'border-civic-dash bg-civic-surface hover:border-civic-muted'
      }`}
    >
      {text}
      <span
        className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg border-[1.5px] ${
          selected ? 'border-civic-accent bg-civic-accent' : 'border-civic-dash bg-civic-surface'
        }`}
        aria-hidden="true"
      >
        {selected && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
    </button>
  )
}
