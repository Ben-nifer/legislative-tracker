import { civicFontClasses } from '@/components/onboarding/fonts'

// Full-screen onboarding in the civic theme (build plan §7); the site header and
// footer are hidden here by SiteChrome
export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return <div className={`theme-civic min-h-dvh ${civicFontClasses}`}>{children}</div>
}
