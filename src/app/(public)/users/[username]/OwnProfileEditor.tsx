'use client'

import { useState } from 'react'
import { Pencil, X, Tag, Bell } from 'lucide-react'
import { PLATFORMS } from './platforms'
import AvatarUpload from '@/app/(auth)/profile/AvatarUpload'
import ProfileEditor from '@/app/(auth)/profile/ProfileEditor'
import InterestTagsEditor from '@/app/(auth)/profile/InterestTagsEditor'
import { updateNotificationPreferences } from '@/app/actions/profile'

type SocialLink = { platform: string; url: string }

type NotifPrefs = {
  hearing_alerts: boolean
  bill_updates: boolean
  comment_engagement: boolean
  new_followers: boolean
}

type TagItem = { id: string; name: string; slug: string; is_predefined: boolean }

type Profile = {
  id: string
  username: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  links: SocialLink[] | null
  notification_preferences: NotifPrefs | null
}

const NOTIF_ROWS = [
  { key: 'hearing_alerts',     label: 'Upcoming hearings',   desc: 'On bills you follow'                    },
  { key: 'bill_updates',       label: 'Bill updates',        desc: 'Status changes on bills you follow'     },
  { key: 'comment_engagement', label: 'Comment engagement',  desc: 'Replies and upvotes on your comments'   },
  { key: 'new_followers',      label: 'New followers',       desc: 'When someone follows you'               },
] as const


export default function OwnProfileEditor({
  profile,
  predefinedTags,
  selectedIds,
  customTags,
}: {
  profile: Profile
  predefinedTags: TagItem[]
  selectedIds: string[]
  customTags: TagItem[]
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

  async function handleNotifToggle(key: keyof NotifPrefs) {
    const updated = { ...notifPrefs, [key]: !notifPrefs[key] }
    setNotifPrefs(updated)
    setNotifSaving(true)
    await updateNotificationPreferences(updated)
    setNotifSaving(false)
  }

  if (!isEditing) {
    return (
      <button
        onClick={() => setIsEditing(true)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
      >
        <Pencil size={13} /> Edit Profile
      </button>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Edit Profile</h2>
        <button
          onClick={() => setIsEditing(false)}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X size={14} /> Done
        </button>
      </div>

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
          {notifSaving && <span className="ml-auto text-xs text-slate-500">Saving…</span>}
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

    </div>
  )
}
