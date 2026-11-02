import { MapPin, Map as MapIcon } from 'lucide-react'
import Link from 'next/link'
import NeighborhoodLookup from '@/components/neighborhood/NeighborhoodLookup'

export const metadata = {
  title: "What's Happening In Your Neighborhood | NYC Legislative Tracker",
  description: 'See ULURP housing/rezoning proposals and DOT street/capital projects near you.',
}

export default function NeighborhoodIndexPage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-nyc-bg px-4 pt-24 sm:px-6">
      <MapPin className="mb-4 text-nyc-orange" size={32} />
      <h1 className="mb-2 text-center text-2xl font-black uppercase tracking-widest text-white">
        What&apos;s Happening In Your Neighborhood
      </h1>
      <p className="mb-8 max-w-md text-center text-sm text-nyc-muted">
        Enter your address to see housing/rezoning proposals and street or
        capital construction projects near you.
      </p>
      <div className="w-full max-w-xl">
        <NeighborhoodLookup />
      </div>
      <Link
        href="/neighborhood/citywide"
        className="mt-6 flex items-center gap-1.5 text-sm text-nyc-muted-light transition-colors hover:text-white"
      >
        <MapIcon size={14} /> Or browse the full citywide map
      </Link>
    </main>
  )
}
