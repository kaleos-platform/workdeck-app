'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SALES_CONTENT_TEMPLATES_PATH } from '@/lib/deck-routes'

type Props = { templateId: string }

export function CloneSystemTemplateButton({ templateId }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClone() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/sc/templates/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloneFrom: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '복제에 실패했습니다')
        return
      }
      router.push(`${SALES_CONTENT_TEMPLATES_PATH}/${data.template.id}`)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-sm">
          시스템 템플릿은 직접 편집할 수 없습니다. 복제해서 사용자 소유의 사본을 만들어 편집하세요.
        </p>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={onClone} disabled={submitting}>
          {submitting ? '복제 중…' : '내 템플릿으로 복제'}
        </Button>
      </CardContent>
    </Card>
  )
}
