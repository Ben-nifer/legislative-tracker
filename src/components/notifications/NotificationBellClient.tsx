'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function NotificationBellClient({
  initialCount,
  userId,
}: {
  initialCount: number
  userId: string
}) {
  const [count, setCount] = useState(initialCount)
  const pathname = usePathname()

  useEffect(() => {
    if (pathname === '/notifications') {
      setCount(0)
    }
  }, [pathname])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('notification-bell')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!payload.new.read) {
            setCount((c) => c + 1)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  const label = count > 9 ? '9+' : count > 0 ? String(count) : null

  return (
    <Link
      href="/notifications"
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
      aria-label={count > 0 ? `${count} unread notifications` : 'Notifications'}
    >
      <Bell size={18} />
      {label && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
          {label}
        </span>
      )}
    </Link>
  )
}
