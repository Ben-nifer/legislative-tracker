import Link from 'next/link'
import { Scale } from 'lucide-react'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-nyc-border/30 bg-nyc-bg">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-3">

          <div>
            <div className="flex items-center gap-2">
              <Scale size={16} className="text-nyc-orange" />
              <span className="text-sm font-black uppercase tracking-widest text-white">NYC Legislative Tracker</span>
            </div>
            <p className="mt-2 text-xs text-nyc-muted-light">Making NYC legislation accessible.</p>
          </div>

          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-widest text-nyc-orange">Browse</p>
            <ul className="space-y-2">
              {[
                { href: '/legislation', label: 'Legislation' },
                { href: '/trending', label: 'Trending' },
                { href: '/council-members', label: 'Council Members' },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-nyc-muted-light transition-colors hover:text-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-widest text-nyc-orange">Resources</p>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="text-sm text-nyc-muted-light transition-colors hover:text-white">
                  About
                </Link>
              </li>
              <li>
                <a href="https://github.com/Ben-nifer/legislative-tracker" target="_blank" rel="noopener noreferrer" className="text-sm text-nyc-muted-light transition-colors hover:text-white">
                  GitHub
                </a>
              </li>
              <li>
                <Link href="/terms" className="text-sm text-nyc-muted-light transition-colors hover:text-white">
                  Terms of Service
                </Link>
              </li>
              <li>
                <a
                  href="https://legistar.council.nyc.gov"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-nyc-muted-light transition-colors hover:text-white"
                >
                  Data from NYC Council
                </a>
              </li>
            </ul>
          </div>

        </div>

        <div className="mt-10 border-t border-nyc-border/30 pt-6 text-center text-xs text-nyc-muted-light">
          Data sourced from NYC Council Legistar API · © {year}
        </div>
      </div>
    </footer>
  )
}
