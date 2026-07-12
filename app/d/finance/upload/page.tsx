import { MultiUploadPanel } from '@/components/finance/upload/multi-upload-panel'

export default function FinanceUploadPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">데이터 등록</h1>
        <p className="text-sm text-muted-foreground">
          은행·카드 거래내역 파일을 업로드해 거래를 가져옵니다 — 여러 파일 동시 등록 가능
        </p>
      </div>
      <MultiUploadPanel />
    </div>
  )
}
