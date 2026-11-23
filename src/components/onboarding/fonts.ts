import localFont from 'next/font/local'

// Loaded only by the civic pages (/welcome and the widget home page), build plan §7.
// Self-hosted (latin subset, variable weights) because next/font/google on Turbopack
// fails the build when Google serves `/l/font?kit=…&skey=…` URLs, as it does on
// Vercel's build machines.
export const inter = localFont({
  src: './font-files/inter-latin.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
})
export const spaceGrotesk = localFont({
  src: './font-files/space-grotesk-latin.woff2',
  weight: '300 700',
  variable: '--font-space-grotesk',
  display: 'swap',
})

export const civicFontClasses = `${inter.variable} ${spaceGrotesk.variable}`
