'use client'

import { useEffect } from 'react'

// 시험용: 화면 요소를 집어 소스 위치를 복사한다. 개발 서버에서만 로드한다.
export function DevReactGrab() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') void import('react-grab')
  }, [])
  return null
}
