import { FinanceUploadPanel } from '@/components/finance/upload-panel'

export default function FinanceUploadPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">데이터 등록</h1>
        <p className="text-sm text-muted-foreground">
          은행·카드 거래내역 파일을 업로드해 거래를 가져옵니다
        </p>
      </div>
      <FinanceUploadPanel />
    </div>
  )
}
