// Logo tile + name, as in the design export's headers
export const APP_NAME = 'NYC Legislative Tracker'

export default function AppMark({ size = 32, showName = true }: { size?: number; showName?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="flex items-center justify-center rounded-[9px] bg-civic-accent"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18" />
          <path d="M5 21V10" />
          <path d="M19 21V10" />
          <path d="M9 21V10" />
          <path d="M15 21V10" />
          <path d="M2 10 12 3l10 7" />
        </svg>
      </span>
      {showName ? <span className="font-display text-lg font-bold text-civic-ink">{APP_NAME}</span> : <span className="sr-only">{APP_NAME}</span>}
    </span>
  )
}
