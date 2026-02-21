'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // 초기 사용자 가져오기
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setUser(user)
      setIsLoading(false)
    }

    getUser()

    // 인증 상태 변화 감지
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null)

      if (event === 'SIGNED_OUT') {
        // 로그아웃 이벤트 발생 시 캐시를 무효화하고 로그인 페이지로 이동
        router.refresh()
        router.push('/login')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router, supabase])

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      toast.error('로그아웃 실패')
      return
    }

    // 로그아웃 성공 토스트만 표시 (리다이렉트는 SIGNED_OUT 이벤트에서 처리)
    toast.success('로그아웃되었습니다')
  }

  return {
    user,
    isLoading,
    signOut,
  }
}
