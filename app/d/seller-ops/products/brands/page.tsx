import { BrandManager } from '@/components/sh/products/brand-manager'

export default function BrandsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">브랜드 관리</h1>
        <p className="text-sm text-muted-foreground">상품에 연결할 브랜드를 등록하고 관리합니다</p>
      </div>
      <BrandManager />
    </div>
  )
}
