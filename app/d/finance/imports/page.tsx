import { Suspense } from 'react'

import Link from 'next/link'

import { ImportsView } from '@/components/finance/imports-view'
import { FINANCE_MAPPING_RULES_PATH } from '@/lib/deck-routes'

export default function FinanceImportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">등록 이력</h1>
          <p className="text-sm text-muted-foreground">
            계좌·카드별 월별 데이터 등록 현황과 업로드 파일 이력을 확인합니다
          </p>
        </div>
        <Link
          href={FINANCE_MAPPING_RULES_PATH}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          매핑 규칙 관리
        </Link>
      </div>
      <Suspense>
        <ImportsView />
      </Suspense>
    </div>
  )
}
