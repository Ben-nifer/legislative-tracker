export type FeedbackPost = {
  id: string
  type: 'feature' | 'bug'
  body: string
  media_url: string | null
  created_at: string
  user_id: string | null
  likeCount: number
  commentCount: number
  isLiked: boolean
  author: { username: string; display_name: string } | null
}

export type FeedbackComment = {
  id: string
  body: string
  created_at: string
  user_id: string | null
  author: { username: string; display_name: string } | null
}
