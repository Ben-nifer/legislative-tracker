import Link from 'next/link'
import AppMark from './AppMark'

// The home page's header from the design export (build plan §7, decided
// 2026-11-22): mark, Home / Search / Watchlist, and the profile. Other pages
// keep the site header until the app-wide restyle.
export default function CivicHeader({ avatarUrl, signedIn, name }: { avatarUrl: string | null; signedIn: boolean; name: string | null }) {
  const link = 'py-1.5 text-[15px] font-semibold no-underline'
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-civic-rule bg-civic-surface px-4 py-4 sm:px-8">
      <Link href="/" className="no-underline" aria-label="Home">
        <AppMark />
      </Link>
      <nav aria-label="Main" className="flex flex-wrap items-center gap-5 sm:gap-[22px]">
        <Link href="/" aria-current="page" className={`${link} border-b-2 border-civic-accent text-civic-ink`}>
          Home
        </Link>
        <Link href="/legislation" className={`${link} text-civic-muted hover:text-civic-ink`}>
          Search
        </Link>
        <Link href={signedIn ? '/following' : '/login?next=/following'} className={`${link} text-civic-muted hover:text-civic-ink`}>
          Watchlist
        </Link>
        {signedIn ? (
          <Link href="/profile" aria-label={name ? `Your profile (${name})` : 'Your profile'} className="block h-[34px] w-[34px] overflow-hidden rounded-full bg-[#E7E5DF]">
            {avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            )}
          </Link>
        ) : (
          <Link href="/login" className={`${link} text-civic-accent`}>
            Sign in
          </Link>
        )}
      </nav>
    </header>
  )
}
