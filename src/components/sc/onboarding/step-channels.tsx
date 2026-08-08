'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { SALES_CONTENT_CHANNELS_PATH, SALES_CONTENT_HOME_PATH } from '@/lib/deck-routes'

type Props = {
  channelCount: number
}

export function StepChannels({ channelCount }: Props) {
  const router = useRouter()
  const [completing, setCompleting] = useState(false)

  async function complete() {
    setCompleting(true)
    try {
      const res = await fetch('/api/sc/onboarding/status', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ completed: true }),
      })
      if (!res.ok) throw new Error('완료 처리 실패')
      toast.success('온보딩을 완료했습니다.')
      router.push(SALES_CONTENT_HOME_PATH)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '완료 처리 실패')
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">배포 채널</h2>
        <p className="text-sm text-muted-foreground">
          콘텐츠를 배포할 채널(블로그·SNS 등)을 등록하면 예약 배포를 사용할 수 있습니다. 지금
          바로 등록하지 않아도 온보딩을 완료할 수 있습니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">채널 등록 현황</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {channelCount > 0 ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
            )}
            <p className="text-sm text-muted-foreground">
              현재 {channelCount}개 채널이 등록되어 있습니다
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={SALES_CONTENT_CHANNELS_PATH}>
              채널 관리 <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" onClick={complete} disabled={completing}>
          {completing ? '완료 처리 중…' : '온보딩 완료'}
        </Button>
      </div>
    </div>
  )
}
