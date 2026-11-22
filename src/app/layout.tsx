import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import SiteChrome from '@/components/layout/SiteChrome'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'NYC Legislative Tracker',
  description: 'Track, understand, and engage with New York City Council legislation.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-nyc-bg">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-nyc-bg text-white`}
      >
        <SiteChrome><Header /></SiteChrome>
        {children}
        <SiteChrome><Footer /></SiteChrome>
      </body>
    </html>
  )
}
