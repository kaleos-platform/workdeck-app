// SaaS 텍스트 공급자 공통 타임아웃 규약.
// 기존 ollama/ACP/image-gemini 는 타임아웃이 없어 무한 대기가 가능했다.
// 신규 SaaS 어댑터는 전부 이 헬퍼를 거친다.

export const DEFAULT_SAAS_TIMEOUT_MS = Number(process.env.AI_SAAS_TIMEOUT_MS || 60_000)

/**
 * 호출부의 abortSignal 과 타임아웃을 합성해 fetch 에 넘긴다.
 * 둘 중 먼저 발생한 쪽이 요청을 끊는다.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  external?: AbortSignal
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('AI 요청 타임아웃')), timeoutMs)
  const onExternalAbort = () => controller.abort(external?.reason)
  if (external) {
    if (external.aborted) controller.abort(external.reason)
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onExternalAbort)
  }
}
