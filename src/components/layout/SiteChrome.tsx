'use client'

import { usePathname } from 'next/navigation'
import { flags } from '@/lib/flags'

// Hides the site header and footer where the civic pages bring their own:
// /welcome (full-screen onboarding) and, with the new-onboarding flag on, the
// widget home page (build plan §7).
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const civic = pathname.startsWith('/welcome') || (flags.newOnboarding && pathname === '/')
  return civic ? null : <>{children}</>
}
