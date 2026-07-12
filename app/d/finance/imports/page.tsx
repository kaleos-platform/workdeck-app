import { Suspense } from 'react'

import { ImportsView } from '@/components/finance/imports-view'

export default function FinanceImportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">등록 이력</h1>
        <p className="text-sm text-muted-foreground">
          계좌·카드별 월별 데이터 등록 현황과 업로드 파일 이력을 확인합니다
        </p>
      </div>
      <Suspense>
        <ImportsView />
      </Suspense>
    </div>
  )
}
