import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

// 서버 렌더링 한 요청 안에서만 인증 조회를 공유한다. 요청 간에는 재사용하지 않는다.
export const getUser = cache(async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})
