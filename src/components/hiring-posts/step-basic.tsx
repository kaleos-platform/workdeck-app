'use client'

import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AutoSaveIndicator } from './autosave-indicator'

type BasicValue = {
  title: string
}

export type StepBasicHandle = { flush: () => Promise<void> }

type Props = {
  ref?: Ref<StepBasicHandle>
  postingId: string
  value: BasicValue
  onChange: (patch: Partial<BasicValue>) => void
}

// 기본 정보 섹션 (controlled) — 공고 제목만 담당.
export function StepBasic({ ref, postingId, value, onChange }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savingRef = useRef<Promise<void> | null>(null)
  // 저장 중 재편집도 누락되지 않도록 마지막으로 저장 요청된 제목을 보관한다.
  const pendingTitleRef = useRef(value.title)
  // 초기값과 같은 제목은 다시 저장하지 않는다.
  const lastSavedRef = useRef(value.title)

  function saveTitle(): Promise<void> {
    const trimmed = value.title.trim()
    if (!trimmed) return Promise.reject(new Error('공고 제목을 입력하세요'))
    pendingTitleRef.current = trimmed
    if (savingRef.current) return savingRef.current
    if (trimmed === lastSavedRef.current) return Promise.resolve()

    setStatus('saving')
    const request = (async () => {
      while (pendingTitleRef.current !== lastSavedRef.current) {
        const title = pendingTitleRef.current
        const res = await fetch(`/api/hiring-posts/postings/${postingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        if (!res.ok) throw new Error('제목 저장에 실패했습니다')
        lastSavedRef.current = title
      }
      setStatus('saved')
      router.refresh()
    })()
    savingRef.current = request
      .catch((error: unknown) => {
        setStatus('idle')
        throw error
      })
      .finally(() => {
        savingRef.current = null
      })
    return savingRef.current
  }

  useImperativeHandle(ref, () => ({ flush: saveTitle }))

  function handleBlur() {
    void saveTitle().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : '제목 저장에 실패했습니다')
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="title">공고 제목</Label>
          <AutoSaveIndicator status={status} />
        </div>
        <Input
          id="title"
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
          onBlur={handleBlur}
          placeholder="예: 강남점 주말 아르바이트 모집"
        />
      </div>
    </div>
  )
}
