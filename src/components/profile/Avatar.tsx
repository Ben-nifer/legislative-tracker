import Image from 'next/image'

const SIZE_CLASSES = {
  sm:  'h-6 w-6 text-[10px]',
  md:  'h-10 w-10 text-sm',
  lg:  'h-20 w-20 text-2xl',
}

export default function Avatar({
  src,
  name,
  size = 'md',
}: {
  src: string | null | undefined
  name: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const cls = `${SIZE_CLASSES[size]} shrink-0 rounded-full`

  if (src) {
    return (
      <Image
        src={src}
        alt={name}
        width={size === 'lg' ? 80 : size === 'md' ? 40 : 24}
        height={size === 'lg' ? 80 : size === 'md' ? 40 : 24}
        className={`${cls} object-cover`}
        unoptimized
      />
    )
  }

  return (
    <div
      className={`${cls} flex items-center justify-center bg-indigo-500/20 font-bold text-indigo-300`}
    >
      {initials}
    </div>
  )
}
