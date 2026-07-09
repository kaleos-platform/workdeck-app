'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AutoSaveIndicator } from './autosave-indicator'

type BasicValue = {
  title: string
}

type Props = {
  postingId: string
  value: BasicValue
  onChange: (patch: Partial<BasicValue>) => void
}

// 기본 정보 섹션 (controlled) — 공고 제목만 담당.
export function StepBasic({ postingId, value, onChange }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savingRef = useRef(false)
  // initialize to current value so first blur on unchanged title skips save
  const lastSavedRef = useRef(value.title)

  async function handleBlur() {
    const trimmed = value.title.trim()
    if (!trimmed) return
    if (trimmed === lastSavedRef.current) return
    if (savingRef.current) return

    savingRef.current = true
    setStatus('saving')
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!res.ok) throw new Error('저장에 실패했습니다')
      lastSavedRef.current = trimmed
      setStatus('saved')
      router.refresh()
      setTimeout(() => setStatus('idle'), 2000)
    } catch (err) {
      setStatus('idle')
      toast.error(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      savingRef.current = false
    }
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
