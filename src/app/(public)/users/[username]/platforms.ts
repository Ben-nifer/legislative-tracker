import { Twitter, Linkedin, Facebook, Instagram, Globe, Link as LinkIcon } from 'lucide-react'

export const PLATFORMS = [
  { key: 'twitter',   label: 'Twitter / X', Icon: Twitter,   color: 'text-sky-400'    },
  { key: 'instagram', label: 'Instagram',   Icon: Instagram,  color: 'text-pink-400'   },
  { key: 'linkedin',  label: 'LinkedIn',    Icon: Linkedin,   color: 'text-blue-400'   },
  { key: 'facebook',  label: 'Facebook',    Icon: Facebook,   color: 'text-blue-500'   },
  { key: 'substack',  label: 'Substack',    Icon: LinkIcon,   color: 'text-orange-400' },
  { key: 'website',   label: 'Website',     Icon: Globe,      color: 'text-slate-400'  },
]
