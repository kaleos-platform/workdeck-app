/**
 * 수집 소스 어댑터 계약 (계획서 §2-4)
 * 크롤링은 "엑셀 파일"을, API는 "행 배열"을 만든다 — 두 모양을 한 계약으로 묶는다.
 */
import type { Page } from 'playwright'
import type { CoupangApiConfig } from '../coupang-api/client.js'

export type CoupangDataSource = 'CRAWL' | 'API'
export type CoupangScope = 'inventory' | 'sales' | 'settlement' | 'product'

export type CollectPayload =
  | { kind: 'file'; buffer: Buffer; filename: string }
  | { kind: 'rows'; rows: InventoryApiRow[] }

// 필드명은 DB(InventoryRecord)/앱 업로드 JSON 계약과 맞춘다(optionId=vendorItemId,
// skuId=externalSkuId 문자열 정규화 — 계획서 §C, Phase0 실측 §4). productId 는 여기 없다:
// 워커는 Prisma 의존이 없어 이력 역산을 못 하고, 앱이 resolveProductIds() 로 채운다.
export interface InventoryApiRow {
  optionId: string
  skuId: string | null
  orderableQuantity: number | null
  salesQty30d: number | null
}

export interface CollectContext {
  workspaceId: string
  snapshotDate: string // KST 자정 ISO
  credential: { loginId: string; password: string } // 크롤링용
  apiCredential: CoupangApiConfig | null // API용
  page?: Page // 크롤링 세션 재사용
}

export interface InventorySourceAdapter {
  readonly source: CoupangDataSource
  collectInventory(ctx: CollectContext): Promise<CollectPayload>
}
