// 캠페인 기본 정보
export type Campaign = {
  id: string
  name: string
  adTypes: string[]
}

// 광고 데이터 행
export type AdRecord = {
  id: string
  date: string
  adType: string
  campaignId: string
  campaignName: string
  adGroup: string | null
  placement: string | null
  productName: string | null
  optionId: string | null
  keyword: string | null
  impressions: number
  clicks: number
  adCost: number
  ctr: number | null
  cvr: number | null
  roas: number | null
  engagementRate: number | null
  orders1d: number
  revenue1d: number
  roas1d: number
  material: string | null
  engagements: number | null
  parsedProductName: string | null
  parsedOptionName: string | null
}

// 비효율 키워드 항목
export type InefficientKeyword = {
  keyword: string
  adCost: number
  clicks: number
  impressions: number
  orders1d: number
  revenue1d: number
  ctr: number | null
  cvr: number | null
  roas: number | null
  removedAt: string | null
}

// 일자별 메모
export type DailyMemo = {
  id: string
  campaignId: string
  date: string
  content: string
  updatedAt?: string
}

// 워크스페이스 전체 KPI 요약
export type KpiSummary = {
  totalAdCost: number
  avgRoas14d: number
  totalClicks: number
  totalImpressions: number
}

// 시계열 지표 데이터 포인트 (CTR/CVR/ROAS 계산값)
export type MetricSeries = {
  date: string
  adCost: number
  totalRevenue: number
  impressions: number
  engagements: number
  ctr: number | null
  cvr: number | null
  roas: number | null
  engagementRate: number | null
}

// 업로드 이력
export type UploadHistory = {
  id: string
  fileName: string
  uploadedAt: string
  periodStart: string
  periodEnd: string
  totalRows: number | null
  insertedRows: number | null
  duplicateRows: number | null
}
