'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createTextSaveQueue } from './text-save-queue'

export type SaveHandle = { flush: () => Promise<void> }

// 전체 값을 교체하는 설정 저장에 기존 직렬 큐를 재사용한다.
export function useQueuedSave<T>(initialValue: T, save: (value: T) => Promise<void>) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savedRef = useRef(JSON.stringify(initialValue))
  const saveRef = useRef(save)
  useLayoutEffect(() => {
    saveRef.current = save
  }, [save])
  // 큐 생성은 콜백을 실행하지 않는다. ref는 실제 저장 요청 시에만 읽는다.
  // eslint-disable-next-line react-hooks/refs
  const [queue] = useState(() =>
    createTextSaveQueue(
      async (_id, data) => {
        const serialized = JSON.stringify(data)
        if (serialized === savedRef.current) return
        setStatus('saving')
        try {
          await saveRef.current(data as T)
          savedRef.current = serialized
          setStatus('saved')
        } catch (error) {
          setStatus('idle')
          throw error
        }
      },
      (error) => toast.error(error instanceof Error ? error.message : '저장에 실패했습니다')
    )
  )
  useEffect(() => () => queue.dispose(), [queue])

  return {
    status,
    schedule(value: T) {
      queue.schedule('value', value)
    },
    flush(value: T) {
      queue.schedule('value', value)
      return queue.flush()
    },
  }
}
