'use client'

import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'workdeck:sidebar-collapsed'

// 같은 탭 내 여러 사이드바 인스턴스 동기화를 위한 구독자 집합
const listeners = new Set<() => void>()

function subscribe(callback: () => void) {
  listeners.add(callback)
  // 다른 탭에서의 변경도 반영
  window.addEventListener('storage', callback)
  return () => {
    listeners.delete(callback)
    window.removeEventListener('storage', callback)
  }
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// 서버 렌더 기본값(펼침). hydration mismatch 방지를 위해 항상 false.
function getServerSnapshot(): boolean {
  return false
}

function persist(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // 무시
  }
  listeners.forEach((l) => l())
}

// 하이드레이션 완료 여부 — 서버/첫 렌더는 false, 클라이언트 마운트 후 true
const noopSubscribe = () => () => {}

/**
 * 사이드바 접힘 상태를 localStorage에 전역 유지한다.
 *
 * useSyncExternalStore로 외부 스토어(localStorage)를 구독해
 * SSR mismatch 없이 안전하게 동기화한다.
 *
 * `mounted`는 하이드레이션 완료 여부. 저장된 접힘 상태가 첫 렌더에서
 * 펼침→접힘으로 바뀌며 width 애니메이션이 튀는 것을 막기 위해,
 * 마운트 전에는 width transition을 끄는 용도로 사용한다.
 */
export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )

  const toggle = useCallback(() => {
    persist(!getSnapshot())
  }, [])

  const expand = useCallback(() => {
    persist(false)
  }, [])

  return { collapsed, toggle, expand, mounted }
}
