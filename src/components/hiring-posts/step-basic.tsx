'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
  const [saving, startSave] = useTransition()

  function handleSave() {
    if (!value.title.trim()) {
      toast.error('제목을 입력하세요')
      return
    }
    startSave(async () => {
      try {
        const res = await fetch(`/api/hiring-posts/postings/${postingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: value.title.trim(),
          }),
        })
        if (!res.ok) throw new Error('저장에 실패했습니다')
        toast.success('공고 제목을 저장했습니다')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '저장에 실패했습니다')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">공고 제목</Label>
        <Input
          id="title"
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="예: 강남점 주말 아르바이트 모집"
        />
      </div>

      <Button size="sm" onClick={handleSave} disabled={saving}>
        공고 제목 저장
      </Button>
    </div>
  )
}
