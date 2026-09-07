/**
 * 크롤링 재고 어댑터 — 기존 collectInventoryData() 를 InventorySourceAdapter 계약으로 감싼다.
 * 기존 함수 시그니처는 절대 바꾸지 않는다(백필·gap 보충이 같은 함수를 공유).
 */
import fs from 'node:fs'
import { collectInventoryData } from '../inventory-collector.js'
import type { CollectContext, CollectPayload, InventorySourceAdapter } from './types.js'

export class InventoryCrawlAdapter implements InventorySourceAdapter {
  readonly source = 'CRAWL' as const

  async collectInventory(ctx: CollectContext): Promise<CollectPayload> {
    const result = await collectInventoryData({
      loginId: ctx.credential.loginId,
      password: ctx.credential.password,
    })

    if (!result.inventoryHealth) {
      throw new Error(
        result.inventoryHealthError ?? '재고 건강성 다운로드: 결과 파일 없음 (원인 미식별)'
      )
    }

    const buffer = fs.readFileSync(result.inventoryHealth.filePath)
    return { kind: 'file', buffer: Buffer.from(buffer), filename: result.inventoryHealth.fileName }
  }
}
