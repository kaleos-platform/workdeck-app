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

export interface InventoryApiRow {
  vendorItemId: string
  externalSkuId: string | null
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
