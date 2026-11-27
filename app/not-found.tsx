import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BackButton } from '@/app/_components/back-button'

export const metadata: Metadata = {
  // 마케팅 구역 안 notFound() 에선 레이아웃 템플릿(%s | Workdeck)이 겹쳐 붙어 absolute 로 고정한다.
  title: { absolute: '페이지를 찾을 수 없습니다 | Workdeck' },
}

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <span className="text-lg font-bold">Workdeck</span>
      <p className="text-6xl font-bold text-muted-foreground">404</p>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">페이지를 찾을 수 없습니다</h1>
        <p className="text-sm text-muted-foreground">
          주소가 바뀌었거나 삭제된 페이지예요.
          <br />
          주소를 다시 확인하거나 홈에서 다시 시작해 주세요.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/">홈으로</Link>
        </Button>
        <BackButton />
      </div>
    </main>
  )
}
