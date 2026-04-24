'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 구 업로드 페이지 — 현재는 registration 화면의 UploadDialog로 통합됨.
 * 즐겨찾기/외부 링크 호환을 위해 리다이렉트만 처리.
 */
export default function Page() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/d/seller-hub/shipping/registration')
  }, [router])
  return null
}
