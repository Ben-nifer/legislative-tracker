'use client'

import { useState } from 'react'
import { Twitter, Linkedin, Facebook, Instagram, Globe, Link as LinkIcon, Tag, Bell, Pencil } from 'lucide-react'
import AvatarUpload from './AvatarUpload'
import ProfileEditor from './ProfileEditor'
import InterestTagsEditor from './InterestTagsEditor'
import Avatar from '@/components/profile/Avatar'
import { updateNotificationPreferences } from '@/app/actions/profile'
import CouncilMemberFinder from './CouncilMemberFinder'

type SocialLink = { platform: string; url: string }

type NotifPrefs = {
  hearing_alerts: boolean
  bill_updates: boolean
  comment_engagement: boolean
  new_followers: boolean
}

type Profile = {
  id: string
  username: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  links: SocialLink[] | null
  notification_preferences: NotifPrefs | null
}

type TagItem = { id: string; name: string; slug: string; is_predefined: boolean }

type CouncilMember = {
  id: string
  full_name: string
  slug: string
  district: number
  borough: string | null
  photo_url: string | null
}

const PLATFORMS = [
  { key: 'twitter',   label: 'Twitter / X', Icon: Twitter,   color: 'text-sky-400'    },
  { key: 'instagram', label: 'Instagram',   Icon: Instagram,  color: 'text-pink-400'   },
  { key: 'linkedin',  label: 'LinkedIn',    Icon: Linkedin,   color: 'text-blue-400'   },
  { key: 'facebook',  label: 'Facebook',    Icon: Facebook,   color: 'text-blue-500'   },
  { key: 'substack',  label: 'Substack',    Icon: LinkIcon,   color: 'text-orange-400' },
  { key: 'website',   label: 'Website',     Icon: Globe,      color: 'text-slate-400'  },
]

const NOTIF_ROWS = [
  { key: 'hearing_alerts',      label: 'Upcoming hearings',    desc: 'On bills you follow'               },
  { key: 'bill_updates',        label: 'Bill updates',         desc: 'Status changes on bills you follow' },
  { key: 'comment_engagement',  label: 'Comment engagement',   desc: 'Replies and upvotes on your comments' },
  { key: 'new_followers',       label: 'New followers',        desc: 'When someone follows you'          },
] as const

export default function ProfilePageClient({
  profile,
  stats,
  predefinedTags,
  selectedIds,
  customTags,
  initialCouncilMember,
  initialCommunityBoard,
}: {
  profile: Profile
  stats: { supporting: number; opposing: number; neutral: number; following: number }
  predefinedTags: TagItem[]
  selectedIds: string[]
  customTags: TagItem[]
  initialCouncilMember: CouncilMember | null
  initialCommunityBoard: string | null
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(
    profile.notification_preferences ?? {
      hearing_alerts: true,
      bill_updates: true,
      comment_engagement: true,
      new_followers: true,
    }
  )
  const [notifSaving, setNotifSaving] = useState(false)

  const activeLinks = (profile.links ?? []).filter(l => l.url.trim())

  async function handleNotifToggle(key: keyof NotifPrefs) {
    const updated = { ...notifPrefs, [key]: !notifPrefs[key] }
    setNotifPrefs(updated)
    setNotifSaving(true)
    await updateNotificationPreferences(updated)
    setNotifSaving(false)
  }

  const selectedTags = predefinedTags.filter(t => selectedIds.includes(t.id))
  const allViewTags = [...selectedTags, ...customTags]

  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4">
      <div className="max-w-xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Profile</h1>
            <p className="text-slate-400 text-sm mt-1">@{profile.username}</p>
          </div>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
            >
              <Pencil size={13} /> Edit Profile
            </button>
          )}
        </div>

        {/* Stats — always visible */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Supporting', value: stats.supporting, color: 'text-emerald-400' },
            { label: 'Opposing',   value: stats.opposing,   color: 'text-red-400'     },
            { label: 'Neutral',    value: stats.neutral,    color: 'text-amber-400'   },
            { label: 'Following',  value: stats.following,  color: 'text-blue-400'    },
          ].map(stat => (
            <div key={stat.label} className="bg-slate-800/80 rounded-xl border border-slate-700 p-3 text-center">
              <div className={`text-xl font-bold tabular-nums ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Council member — always visible */}
        <CouncilMemberFinder
          initialMember={initialCouncilMember}
          initialCommunityBoard={initialCommunityBoard}
        />

        {isEditing ? (
          /* ── EDIT MODE ── */
          <>
            <div className="flex justify-center">
              <AvatarUpload
                userId={profile.id}
                initialUrl={profile.avatar_url ?? null}
                displayName={profile.display_name}
              />
            </div>

            <ProfileEditor
              profile={profile}
              onSaved={() => setIsEditing(false)}
              onCancel={() => setIsEditing(false)}
            />

            <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-6">
              <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-white">
                <Tag size={16} className="text-purple-400" /> Interests
              </h2>
              <p className="mb-4 text-xs text-slate-500">
                Select predefined interests or create your own. These appear on your public profile.
              </p>
              <InterestTagsEditor
                predefinedTags={predefinedTags}
                initialSelectedIds={selectedIds}
                initialCustomTags={customTags}
              />
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-6">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
                <Bell size={16} className="text-indigo-400" /> Notifications
                {notifSaving && (
                  <span className="ml-auto text-xs text-slate-500">Saving…</span>
                )}
              </h2>
              <div className="space-y-4">
                {NOTIF_ROWS.map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-slate-200">{label}</p>
                      <p className="text-xs text-slate-500">{desc}</p>
                    </div>
                    <button
                      onClick={() => handleNotifToggle(key)}
                      role="switch"
                      aria-checked={notifPrefs[key]}
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        notifPrefs[key] ? 'bg-indigo-500' : 'bg-slate-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          notifPrefs[key] ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* ── VIEW MODE ── */
          <>
            {/* Avatar + bio + links */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-6 flex gap-5 items-start">
              <Avatar src={profile.avatar_url} name={profile.display_name} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white">{profile.display_name}</p>
                <p className="text-sm text-slate-500 mt-0.5">@{profile.username}</p>
                {profile.bio && (
                  <p className="mt-2 text-sm text-slate-300">{profile.bio}</p>
                )}
                {activeLinks.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeLinks.map(({ platform, url }) => {
                      const p = PLATFORMS.find(pl => pl.key === platform)
                      const Icon = p?.Icon ?? LinkIcon
                      const color = p?.color ?? 'text-slate-400'
                      const href = url.startsWith('http') ? url : `https://${url}`
                      return (
                        <a
                          key={platform}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={p?.label ?? platform}
                          className={`flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs ${color} transition-colors hover:border-slate-600`}
                        >
                          <Icon size={13} />
                          {p?.label ?? platform}
                        </a>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Interest tags */}
            {allViewTags.length > 0 && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-6">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                  <Tag size={14} className="text-purple-400" /> Interests
                </h2>
                <div className="flex flex-wrap gap-2">
                  {allViewTags.map(tag => (
                    <span key={tag.id} className="rounded-full bg-slate-700 px-3 py-1 text-xs text-slate-300">
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
