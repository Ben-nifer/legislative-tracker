'use client'

import { useState } from 'react'
import { updateProfile } from '@/app/actions/profile'
import { Twitter, Linkedin, Facebook, Instagram, Globe, Link as LinkIcon } from 'lucide-react'

type SocialLink = { platform: string; url: string }

const PLATFORMS = [
  { key: 'twitter',   label: 'Twitter / X', Icon: Twitter   },
  { key: 'instagram', label: 'Instagram',   Icon: Instagram  },
  { key: 'linkedin',  label: 'LinkedIn',    Icon: Linkedin   },
  { key: 'facebook',  label: 'Facebook',    Icon: Facebook   },
  { key: 'substack',  label: 'Substack',    Icon: LinkIcon   },
  { key: 'website',   label: 'Website',     Icon: Globe      },
]

type Profile = {
  username: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  links: SocialLink[] | null
}

export default function ProfileEditor({
  profile,
  onSaved,
  onCancel,
}: {
  profile: Profile
  onSaved?: () => void
  onCancel?: () => void
}) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? '')
  const [bio, setBio] = useState(profile.bio ?? '')
  const [links, setLinks] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const { key } of PLATFORMS) map[key] = ''
    for (const { platform, url } of profile.links ?? []) map[platform] = url
    return map
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const linksArray: SocialLink[] = PLATFORMS
      .map(({ key }) => ({ platform: key, url: links[key]?.trim() ?? '' }))
      .filter(({ url }) => url !== '')

    const result = await updateProfile({
      display_name: displayName,
      bio: bio || null,
      links: linksArray,
    })

    setSaving(false)
    if (result.error) {
      setError(result.error)
    } else {
      onSaved?.()
    }
  }

  return (
    <div className="bg-slate-800/80 backdrop-blur rounded-xl border border-slate-700 p-6">
      <h2 className="text-base font-semibold text-white mb-5">Edit profile</h2>
      <form onSubmit={handleSubmit} className="space-y-5">

        <div>
          <label htmlFor="displayName" className="block text-sm text-slate-300 mb-1.5">
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={50}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-600 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm text-slate-300 mb-1.5">
            Bio <span className="text-slate-500">(optional)</span>
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell others a bit about yourself..."
            rows={3}
            maxLength={200}
            className="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-600 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
          />
          <p className="text-xs text-slate-600 mt-1 text-right">{bio.length}/200</p>
        </div>

        <div>
          <p className="text-sm text-slate-300 mb-3">
            Social links <span className="text-slate-500">(optional)</span>
          </p>
          <div className="space-y-2.5">
            {PLATFORMS.map(({ key, label, Icon }) => (
              <div key={key} className="flex items-center gap-2.5">
                <Icon size={15} className="shrink-0 text-slate-500" />
                <input
                  type="url"
                  placeholder={label}
                  value={links[key] ?? ''}
                  onChange={(e) => setLinks(prev => ({ ...prev, [key]: e.target.value }))}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving || !displayName}
            className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 transition-colors hover:text-slate-200"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
