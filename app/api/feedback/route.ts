import { NextRequest } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { errorResponse } from '@/lib/api-helpers'
import { submitFeedback } from '@/lib/feedback/submit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)
  return submitFeedback(req, user)
}
