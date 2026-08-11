import Link from 'next/link'

import { MultiUploadPanel } from '@/components/finance/upload/multi-upload-panel'
import { FINANCE_MAPPING_RULES_PATH } from '@/lib/deck-routes'

export default function FinanceUploadPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">데이터 등록</h1>
          <p className="text-sm text-muted-foreground">
            은행·카드 거래내역 파일을 업로드해 거래를 가져옵니다 — 여러 파일 동시 등록 가능
          </p>
        </div>
        {/* 파일을 올리기 전에도 기억된 컬럼 매핑 규칙을 확인·정리할 수 있게 진입점 제공 */}
        <Link
          href={FINANCE_MAPPING_RULES_PATH}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          매핑 규칙 관리
        </Link>
      </div>
      <MultiUploadPanel />
    </div>
  )
}
