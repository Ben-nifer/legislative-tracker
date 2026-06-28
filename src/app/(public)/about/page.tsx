import Link from 'next/link'
import Image from 'next/image'
import { Scale, Github } from 'lucide-react'

export const metadata = {
  title: 'About | NYC Legislative Tracker',
  description: 'About the NYC Legislative Tracker — making city council legislation accessible to every New Yorker.',
}

const FOUNDERS = [
  {
    name: 'Ben Listman',
    bio: 'Holds a Master\'s in Urban Planning from NYU Wagner and serves on Manhattan Community Board 3. He knows more about zoning text amendments than any person should reasonably be expected to know, and he\'s genuinely excited about it.',
  },
  {
    name: 'Yosef Kessler',
    bio: 'Graduated from Hunter College and works at PopWheels, helping delivery workers access safe and convenient battery swaps across the city. He believes good infrastructure — physical or civic — should work for everyone.',
  },
]

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="mb-8 flex items-center gap-3">
        <Scale size={28} className="text-nyc-orange" />
        <h1 className="text-3xl font-black uppercase tracking-widest text-white">About</h1>
      </div>

      <div className="space-y-8 text-nyc-muted-light">

        {/* Tagline + intro */}
        <section>
          <p className="mb-4 text-lg font-semibold italic text-white">
            NYC&apos;s legislation, made for the rest of us.
          </p>
          <p className="mb-3">
            New York City Council introduces and debates thousands of bills every year — on housing,
            public safety, transportation, small businesses, and everything in between — with hundreds
            becoming law. As civically minded New Yorkers, we realized that we didn&apos;t have an easy
            way to follow, learn and engage with the legislation that impacts our city.
          </p>
          <p>
            We built Legislative Tracker to change that. Browse bills, take a stance, follow your
            council member, and see what your neighbors actually think — all in one place.
          </p>
        </section>

        {/* Why we built this */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Why We Built This</h2>
          <p className="mb-3">
            We&apos;ve sat in community board meetings and wondered: are the thirty people in this room
            really representative of the neighborhood? We&apos;ve also seen a bill go viral on Twitter and
            wondered the same thing.
          </p>
          <p className="mb-3">
            We were also inspired by the City&apos;s newly created Department of Mass Engagement, in trying
            to answer one of democracy&apos;s most fundamental questions: what do the people actually think?
            Not just the people with free time to show up to a Tuesday evening meeting. Not just the
            people with the largest social media presence. Everyone.
          </p>
          <p className="mb-3">
            We&apos;re trying to build a lower barrier to entry for civic participation, and a more honest
            picture of where New Yorkers actually stand.
          </p>
          <p>
            Oh, and we also thought it would be a really fun project to build.
          </p>
        </section>

        {/* Who we are */}
        <section>
          <h2 className="mb-5 text-lg font-bold text-white">Who We Are</h2>
          <div className="relative mb-6 w-full overflow-hidden rounded border border-nyc-border/30" style={{ aspectRatio: '16/9' }}>
            <Image
              src="/about/IMG_8587.JPG"
              alt="Ben Listman and Yosef Kessler"
              fill
              className="object-cover object-[center_60%]"
            />
          </div>
          <div className="space-y-4">
            {FOUNDERS.map((founder) => (
              <div key={founder.name}>
                <p className="font-bold text-white">{founder.name}</p>
                <p className="mt-1">{founder.bio}</p>
              </div>
            ))}
          </div>
          <p className="mt-4">
            We&apos;ve been friends for a long time. This project is equal parts passion project and
            excuse to build something together.
          </p>
        </section>

        {/* Get involved */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Get Involved</h2>
          <p>
            This is a living project, and we&apos;d love your help making it better. Whether you&apos;ve
            spotted a bug, have an idea for a feature, want to collaborate, or just want to say hi,
            our inboxes are open.
          </p>
          <p className="mt-2">
            <a href="mailto:yokessler@gmail.com" className="text-nyc-orange hover:underline transition-colors">
              yokessler@gmail.com
            </a>
            {' · '}
            <a href="mailto:benjaminlistman@gmail.com" className="text-nyc-orange hover:underline transition-colors">
              benjaminlistman@gmail.com
            </a>
          </p>
        </section>

        {/* Data */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Data</h2>
          <p>
            Legislative data is sourced from the{' '}
            <a
              href="https://legistar.council.nyc.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-nyc-orange transition-colors hover:underline"
            >
              NYC Council Legistar API
            </a>
            , which is public record. Bill summaries are generated using AI to make them more
            readable — always verify important details directly with the NYC Council.
          </p>
        </section>

        {/* Open source */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Open source</h2>
          <p>
            This project is open source. View the code, report issues, or contribute on{' '}
            <a
              href="https://github.com/Ben-nifer/legislative-tracker"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-nyc-orange transition-colors hover:underline"
            >
              <Github size={14} />
              GitHub
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-12 border-t border-nyc-border/30 pt-6">
        <Link
          href="/"
          className="text-sm text-nyc-muted-light transition-colors hover:text-white"
        >
          &larr; Back to home
        </Link>
      </div>
    </div>
  )
}
