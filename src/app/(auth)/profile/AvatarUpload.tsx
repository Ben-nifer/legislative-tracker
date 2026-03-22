'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Camera, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { updateAvatarUrl } from '@/app/actions/profile'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

export default function AvatarUpload({
  userId,
  initialUrl,
  displayName,
}: {
  userId: string
  initialUrl: string | null
  displayName: string
}) {
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)

    if (!ACCEPTED.includes(file.type)) {
      setError('Please upload a JPG, PNG, or WebP image.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Image must be 2 MB or smaller.')
      return
    }

    setUploading(true)

    const supabase = createClient()
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${userId}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type })

    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

    // Append a cache-buster so the browser picks up the new image immediately
    const bustedUrl = `${publicUrl}?t=${Date.now()}`

    const result = await updateAvatarUrl(publicUrl)
    if (result.error) {
      setError(result.error)
      setUploading(false)
      return
    }

    setUrl(bustedUrl)
    setUploading(false)

    // Reset so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => !uploading && inputRef.current?.click()}
        className="group relative h-24 w-24 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        title="Change profile photo"
        disabled={uploading}
      >
        {/* Avatar image or initials */}
        {url ? (
          <Image
            src={url}
            alt={displayName}
            width={96}
            height={96}
            className="h-24 w-24 rounded-full object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-indigo-500/20 text-3xl font-bold text-indigo-300">
            {initials}
          </div>
        )}

        {/* Hover / loading overlay */}
        <div
          className={[
            'absolute inset-0 flex items-center justify-center rounded-full transition-colors',
            uploading
              ? 'bg-black/50'
              : 'bg-black/0 group-hover:bg-black/40',
          ].join(' ')}
        >
          {uploading ? (
            <Loader2 size={24} className="animate-spin text-white" />
          ) : (
            <Camera size={20} className="text-white opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
      </button>

      <p className="text-xs text-slate-500">
        {uploading ? 'Uploading…' : 'Click to change photo · JPG, PNG, WebP · max 2 MB'}
      </p>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
