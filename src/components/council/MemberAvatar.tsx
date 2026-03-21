'use client'

import { useState } from 'react'

export default function MemberAvatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name: string
  photoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const [imgError, setImgError] = useState(false)

  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const sizeClasses = {
    sm: 'h-10 w-10 text-sm',
    md: 'h-14 w-14 text-base',
    lg: 'h-16 w-16 text-xl',
  }

  const showPhoto = photoUrl && !imgError

  return (
    <div
      className={`${sizeClasses[size]} shrink-0 overflow-hidden rounded-full bg-indigo-500/20 font-semibold text-indigo-300 flex items-center justify-center`}
    >
      {showPhoto ? (
        <img
          src={photoUrl}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        initials
      )}
    </div>
  )
}
