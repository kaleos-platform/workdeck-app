type Entry = {
  pending: { data: unknown } | null
  timer?: ReturnType<typeof setTimeout>
  running?: Promise<void>
}

// 같은 블록의 요청을 직렬화하고, 실패한 최신 본문을 재시도할 때까지 보관한다.
export function createTextSaveQueue(
  save: (id: string, data: unknown) => Promise<unknown>,
  onError: (error: unknown) => void
) {
  const entries = new Map<string, Entry>()

  function drain(id: string, entry: Entry): Promise<void> {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    if (entry.running) return entry.running
    const request = (async () => {
      while (entry.pending) {
        const pending = entry.pending
        entry.pending = null
        try {
          await save(id, pending.data)
        } catch (error) {
          // 요청 도중 새 편집이 생겼다면 이전 본문 대신 새 본문을 남긴다.
          entry.pending ??= pending
          throw error
        }
      }
    })()
    entry.running = request.finally(() => {
      entry.running = undefined
    })
    return entry.running
  }

  return {
    schedule(id: string, data: unknown) {
      const entry = entries.get(id) ?? { pending: null }
      entries.set(id, entry)
      entry.pending = { data }
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        void drain(id, entry).catch(onError)
      }, 700)
    },
    async flush() {
      // 다른 블록이 실패해도 모든 진행 요청이 끝난 뒤 실패를 전달한다.
      const results = await Promise.allSettled([...entries].map(([id, entry]) => drain(id, entry)))
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    },
    cancel(id: string) {
      const entry = entries.get(id)
      if (entry?.timer) clearTimeout(entry.timer)
      if (entry) entry.pending = null
      entries.delete(id)
    },
    dispose() {
      for (const entry of entries.values()) if (entry.timer) clearTimeout(entry.timer)
    },
  }
}
