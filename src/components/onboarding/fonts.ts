import { Inter, Space_Grotesk } from 'next/font/google'

// Loaded only by the civic pages (/welcome and the widget home page), build plan §7
export const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

export const civicFontClasses = `${inter.variable} ${spaceGrotesk.variable}`
