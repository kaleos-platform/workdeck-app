import { ProductionRunsTable } from '@/components/sh/products/production/production-runs-table'

export default function ProductionPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">생산 관리</h1>
        <p className="text-sm text-muted-foreground">
          상품 발주(생산) 차수와 옵션별 발주량·생산 원가를 관리합니다
        </p>
      </div>
      <ProductionRunsTable />
    </div>
  )
}
