'use client'

import * as React from 'react'
import { useSelectedLayoutSegments } from 'next/navigation'
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes'

/**
 * 마케팅 사이트(app/(marketing) route group)는 시스템 다크 설정과 무관하게 항상 라이트. 앱은 props(system) 그대로.
 * 경로 문자열이 아니라 실제로 매칭된 route group으로 판정한다 — 어드민 루트 rewrite(/ → /admin)·마케팅 404도 맞게 잡힌다.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const isMarketing = useSelectedLayoutSegments()[0] === '(marketing)'
  return (
    <NextThemesProvider {...props} forcedTheme={isMarketing ? 'light' : props.forcedTheme}>
      {children}
    </NextThemesProvider>
  )
}
