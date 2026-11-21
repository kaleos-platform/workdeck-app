'use client'
// TEMP: preview Sentry 검증용 — 머지 전 제거
export function ClientThrow() {
  return (
    <button
      onClick={() => {
        throw new Error('sentry-test client hong@example.com')
      }}
    >
      client throw
    </button>
  )
}
