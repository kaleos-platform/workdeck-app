import type {
  Campaign,
  AdRecord,
  InefficientKeyword,
  DailyMemo,
  KpiSummary,
  MetricSeries,
  UploadHistory,
} from '@/types'

// 기준 날짜 (오늘)
const today = new Date('2026-02-21')
function dateStr(daysAgo: number): string {
  const d = new Date(today)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

// 캠페인 목록
export const DUMMY_CAMPAIGNS: Campaign[] = [
  { id: 'camp-001', name: '봄 시즌 키워드 캠페인', adTypes: ['키워드 광고'] },
  { id: 'camp-002', name: '신상품 상품 광고', adTypes: ['상품 광고'] },
  { id: 'camp-003', name: '브랜드 통합 캠페인', adTypes: ['키워드 광고', '상품 광고'] },
]

// 14일치 시계열 더미 데이터
export const DUMMY_METRIC_SERIES: MetricSeries[] = Array.from({ length: 14 }, (_, i) => ({
  date: dateStr(13 - i),
  adCost: Math.round(80000 + Math.random() * 120000),
  totalRevenue: Math.round(200000 + Math.random() * 300000),
  impressions: Math.round(2000 + Math.random() * 8000),
  engagements: Math.round(50 + Math.random() * 250),
  ctr: parseFloat((1.5 + Math.random() * 3.5).toFixed(1)),
  cvr: parseFloat((0.5 + Math.random() * 2.5).toFixed(1)),
  roas: parseFloat((150 + Math.random() * 350).toFixed(1)),
  engagementRate: parseFloat((0.8 + Math.random() * 4.2).toFixed(1)),
}))

// 광고 데이터 행 (camp-001 기준 14일치 × 2 광고유형)
export const DUMMY_AD_RECORDS: AdRecord[] = [
  ...Array.from({ length: 14 }, (_, i) => ({
    id: `rec-k-${i + 1}`,
    date: dateStr(13 - i),
    adType: '키워드 광고',
    campaignId: 'camp-001',
    campaignName: '봄 시즌 키워드 캠페인',
    adGroup: '봄 키워드 그룹',
    placement: null,
    productName: null,
    optionId: null,
    keyword: i % 3 === 0 ? null : `키워드${(i % 5) + 1}`,
    impressions: Math.round(1000 + Math.random() * 5000),
    clicks: Math.round(50 + Math.random() * 300),
    adCost: Math.round(10000 + Math.random() * 50000),
    ctr: parseFloat((1.5 + Math.random() * 3.5).toFixed(1)),
    cvr: parseFloat((0.5 + Math.random() * 2.5).toFixed(1)),
    roas: parseFloat((100 + Math.random() * 400).toFixed(1)),
    engagementRate: null,
    orders1d: Math.round(Math.random() * 20),
    revenue1d: Math.round(Math.random() * 500000),
    roas1d: parseFloat((100 + Math.random() * 400).toFixed(1)),
    material: null,
    engagements: null,
    parsedProductName: null,
    parsedOptionName: null,
  })),
  ...Array.from({ length: 14 }, (_, i) => ({
    id: `rec-p-${i + 1}`,
    date: dateStr(13 - i),
    adType: '상품 광고',
    campaignId: 'camp-001',
    campaignName: '봄 시즌 키워드 캠페인',
    adGroup: null,
    placement: '검색 상단',
    productName: `봄 신상 블라우스 구성: 단품, 사이즈: M`,
    optionId: `OPT-00${(i % 3) + 1}`,
    keyword: null,
    impressions: Math.round(2000 + Math.random() * 8000),
    clicks: Math.round(100 + Math.random() * 400),
    adCost: Math.round(20000 + Math.random() * 80000),
    ctr: parseFloat((1.2 + Math.random() * 2.8).toFixed(1)),
    cvr: parseFloat((0.8 + Math.random() * 3.2).toFixed(1)),
    roas: parseFloat((120 + Math.random() * 380).toFixed(1)),
    engagementRate: null,
    orders1d: Math.round(Math.random() * 30),
    revenue1d: Math.round(Math.random() * 800000),
    roas1d: parseFloat((120 + Math.random() * 380).toFixed(1)),
    material: null,
    engagements: null,
    parsedProductName: '봄 신상 블라우스',
    parsedOptionName: '단품 / M',
  })),
]

// 비효율 키워드 (adCost > 0, orders1d = 0)
export const DUMMY_KEYWORDS: InefficientKeyword[] = [
  {
    keyword: '프리미엄 봄 원피스',
    adCost: 45200,
    clicks: 120,
    impressions: 5200,
    orders1d: 0,
    revenue1d: 0,
    ctr: 2.3,
    cvr: null,
    roas: null,
    removedAt: null,
  },
  {
    keyword: '여성 플리츠 스커트',
    adCost: 32100,
    clicks: 95,
    impressions: 3800,
    orders1d: 0,
    revenue1d: 0,
    ctr: 2.5,
    cvr: null,
    roas: null,
    removedAt: null,
  },
  {
    keyword: '봄 신상 블라우스',
    adCost: 28700,
    clicks: 88,
    impressions: 3800,
    orders1d: 0,
    revenue1d: 0,
    ctr: 2.3,
    cvr: null,
    roas: null,
    removedAt: null,
  },
  {
    keyword: '캐주얼 린넨 팬츠',
    adCost: 19500,
    clicks: 62,
    impressions: 2480,
    orders1d: 0,
    revenue1d: 0,
    ctr: 2.5,
    cvr: null,
    roas: null,
    removedAt: null,
  },
  {
    keyword: '오버핏 봄 재킷',
    adCost: 15800,
    clicks: 54,
    impressions: 2250,
    orders1d: 0,
    revenue1d: 0,
    ctr: 2.4,
    cvr: null,
    roas: null,
    removedAt: null,
  },
]

// 일자별 메모
export const DUMMY_MEMOS: DailyMemo[] = [
  {
    id: 'memo-001',
    campaignId: 'camp-001',
    date: dateStr(3),
    content: '입찰가 10% 상향 조정. ROAS 개선 추이 관찰 필요.',
  },
  {
    id: 'memo-002',
    campaignId: 'camp-001',
    date: dateStr(7),
    content: '주말 트래픽 급증으로 예산 소진. 일일 예산 증액 검토.',
  },
  {
    id: 'memo-003',
    campaignId: 'camp-001',
    date: dateStr(10),
    content: '비효율 키워드 5개 제외 처리. 광고비 절감 효과 모니터링.',
  },
]

// 전체 KPI 요약
export const DUMMY_KPI: KpiSummary = {
  totalAdCost: 3850000,
  avgRoas14d: 287.4,
  totalClicks: 12430,
  totalImpressions: 284500,
}

// 업로드 이력
export const DUMMY_UPLOAD_HISTORY: UploadHistory[] = [
  {
    id: 'upload-001',
    fileName: '쿠팡광고리포트_20260207_20260221.xlsx',
    uploadedAt: dateStr(0),
    periodStart: dateStr(14),
    periodEnd: dateStr(0),
    totalRows: 300,
    insertedRows: 288,
    duplicateRows: 12,
  },
  {
    id: 'upload-002',
    fileName: '쿠팡광고리포트_20260124_20260206.xlsx',
    uploadedAt: dateStr(15),
    periodStart: dateStr(28),
    periodEnd: dateStr(15),
    totalRows: 245,
    insertedRows: 245,
    duplicateRows: 0,
  },
]
