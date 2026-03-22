'use client'

import { useState } from 'react'
import { UserPlus, UserCheck } from 'lucide-react'
import { followUser, unfollowUser } from '@/app/actions/social'

export default function FollowUserButton({
  targetUserId,
  initialIsFollowing,
  isOwnProfile,
}: {
  targetUserId: string
  initialIsFollowing: boolean
  isOwnProfile: boolean
}) {
  const [following, setFollowing] = useState(initialIsFollowing)
  const [pending, setPending] = useState(false)

  if (isOwnProfile) return null

  async function handleClick() {
    if (pending) return
    const next = !following
    setFollowing(next)
    setPending(true)
    const result = next
      ? await followUser(targetUserId)
      : await unfollowUser(targetUserId)
    setPending(false)
    if (result.error) setFollowing(!next)
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={[
        'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60',
        following
          ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300'
          : 'border-slate-700 text-slate-300 hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:text-indigo-300',
      ].join(' ')}
    >
      {following ? (
        <><UserCheck size={15} /> Following</>
      ) : (
        <><UserPlus size={15} /> Follow</>
      )}
    </button>
  )
}
