'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Lightbulb, Bug, ImageIcon, X, Loader2, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { submitFeedback } from '@/app/actions/feedback'

const MAX_CHARS = 1000
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export default function FeedbackForm({ userId }: { userId: string | null }) {
  const router = useRouter()
  const [type, setType] = useState<'feature' | 'bug'>('feature')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setError(null)
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError('Please upload a JPG, PNG, WebP, or GIF.')
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      setError('Image must be 10 MB or smaller.')
      return
    }
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  function removeFile() {
    setFile(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || submitting) return
    setSubmitting(true)
    setError(null)

    let mediaUrl: string | null = null

    if (file && userId) {
      setUploading(true)
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${userId}/${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('feedback-media')
        .upload(path, file, { contentType: file.type })
      setUploading(false)
      if (uploadError) {
        setError(uploadError.message)
        setSubmitting(false)
        return
      }
      const { data: { publicUrl } } = supabase.storage.from('feedback-media').getPublicUrl(path)
      mediaUrl = publicUrl
    }

    const result = await submitFeedback(type, body, mediaUrl, file ? 'image' : null)
    setSubmitting(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setBody('')
    removeFile()
    setSuccess(true)
    router.refresh()
    setTimeout(() => setSuccess(false), 4000)
  }

  if (!userId) {
    return (
      <div className="rounded-xl border border-nyc-border bg-nyc-card p-6 text-center shadow-sm">
        <p className="mb-1 text-sm font-bold text-nyc-blue">Have feedback?</p>
        <p className="mb-4 text-xs text-nyc-muted">Sign in to share feature requests, bug reports, or suggestions.</p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-nyc-orange px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-nyc-orange-hover"
        >
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-nyc-border bg-nyc-card p-6 shadow-sm">
      <h2 className="mb-1 text-base font-black uppercase tracking-wide text-nyc-blue">
        Share Your Feedback
      </h2>
      <p className="mb-5 text-xs text-nyc-muted">Feature request, bug report, or anything else.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type selector */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('feature')}
            className={[
              'flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-bold transition-colors',
              type === 'feature'
                ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                : 'border-nyc-border text-nyc-muted hover:border-indigo-300 hover:text-indigo-600',
            ].join(' ')}
          >
            <Lightbulb size={14} />
            Feature
          </button>
          <button
            type="button"
            onClick={() => setType('bug')}
            className={[
              'flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-bold transition-colors',
              type === 'bug'
                ? 'border-red-400 bg-red-50 text-red-700'
                : 'border-nyc-border text-nyc-muted hover:border-red-300 hover:text-red-600',
            ].join(' ')}
          >
            <Bug size={14} />
            Bug
          </button>
        </div>

        {/* Textarea */}
        <div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MAX_CHARS}
            rows={5}
            placeholder={
              type === 'feature'
                ? "Describe the feature you'd like to see..."
                : 'Describe the bug you encountered...'
            }
            className="w-full resize-none rounded-lg border border-nyc-border bg-white p-3 text-sm text-nyc-blue placeholder-nyc-muted/40 focus:border-nyc-orange focus:outline-none focus:ring-1 focus:ring-nyc-orange transition-colors"
          />
          <p
            className={[
              'mt-1 text-right text-xs',
              body.length > MAX_CHARS * 0.9 ? 'text-red-500' : 'text-nyc-muted/60',
            ].join(' ')}
          >
            {body.length}/{MAX_CHARS}
          </p>
        </div>

        {/* Image upload */}
        {preview ? (
          <div className="relative overflow-hidden rounded-lg border border-nyc-border">
            <Image
              src={preview}
              alt="Preview"
              width={400}
              height={200}
              className="max-h-40 w-full object-cover"
              unoptimized
            />
            <button
              type="button"
              onClick={removeFile}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-black/80"
              aria-label="Remove image"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-nyc-border py-3 text-xs font-medium text-nyc-muted transition-colors hover:border-nyc-blue hover:text-nyc-blue"
          >
            <ImageIcon size={14} />
            Add screenshot (optional)
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          className="hidden"
          onChange={handleFileChange}
        />

        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && (
          <p className="text-xs font-medium text-emerald-600">
            Feedback submitted — thank you!
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !body.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-nyc-orange px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-nyc-orange-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          {uploading ? 'Uploading...' : submitting ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </form>
    </div>
  )
}
