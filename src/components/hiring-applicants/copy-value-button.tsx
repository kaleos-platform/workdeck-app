'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

// 값을 prop 으로 받지 않는다(PII 는 서버 렌더 HTML 에만 둔다). 가장 가까운 [data-copy-root] 안의
// [data-copy-value] 텍스트를 클릭 시점에 읽어 복사한다.
export function CopyValueButton({ label }: { label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(e: React.MouseEvent<HTMLButtonElement>) {
    const text = e.currentTarget
      .closest('[data-copy-root]')
      ?.querySelector('[data-copy-value]')
      ?.textContent?.trim()
    if (!text || text === '-') return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('복사하지 못했습니다')
    }
  }

  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      className="text-muted-foreground"
      aria-label={`${label} 복사`}
      onClick={copy}
    >
      {copied ? <Check className="mr-1 size-3" /> : <Copy className="mr-1 size-3" />}
      {copied ? '복사됨' : '복사'}
    </Button>
  )
}
