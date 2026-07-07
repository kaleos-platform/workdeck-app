/**
 * coupang-ads 캠페인 삭제·중복감지 버그 e2e
 *
 * 테스트 A: 캠페인 DELETE 시 ProductStatus 고아 행이 함께 삭제되는지 검증 (감사 Medium)
 * 테스트 B: 중복 감지가 다른 캠페인 데이터를 오탐하지 않는지 검증 (감사 Medium)
 *
 * throwaway Workspace+User 시드, afterAll cascade 복원.
 * DATABASE_URL/DIRECT_URL 없으면 전체 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

// resolveWorkspace는 route 핸들러 내부에서 호출되므로 mock 처리
jest.mock('@/lib/api-helpers', () => ({
  __esModule: true,
  resolveWorkspace: jest.fn(),
  errorResponse: jest.fn((msg: string, status: number) => {
    const { NextResponse } = jest.requireActual('next/server')
    return NextResponse.json({ error: msg }, { status })
  }),
}))

// 캐시 무효화는 부수효과이므로 무시
jest.mock('@/lib/coupang-ads/cache', () => ({
  __esModule: true,
  invalidateCoupangAdsCache: jest.fn(),
}))

// 중복감지(테스트 B)에서 excel-parser mock
jest.mock('@/lib/excel-parser', () => ({
  __esModule: true,
  parseExcelBuffer: jest.fn(),
  parseCsvBuffer: jest.fn(),
  detectPeriod: jest.fn(),
  ColumnValidationError: class ColumnValidationError extends Error {
    detail: { missingColumns: string[]; foundColumns: string[] }
    constructor(detail: { missingColumns: string[]; foundColumns: string[] }) {
      super('column validation error')
      this.detail = detail
    }
  },
}))

import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'
import { parseExcelBuffer, detectPeriod } from '@/lib/excel-parser'
import type { ParsedRow } from '@/lib/excel-parser'
import { processUpload } from '@/lib/upload-processor'
import { NextRequest } from 'next/server'

// throwaway ID — 다른 e2e 테스트와 충돌 없도록 고유 hex 사용
const WS_ID = 'e2e00000-0000-4000-8000-00000000cc01'
const USER_ID = 'e2e00000-0000-4000-8000-00000000cc02'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

// ReportUpload 필수 필드
const PERIOD_START = new Date('2026-06-01T00:00:00Z')
const PERIOD_END = new Date('2026-06-30T23:59:59Z')

// AdRecord 필수 필드 헬퍼 (reportId는 호출 측에서 주입)
function makeAdRecord(campaignId: string): {
  date: Date
  adType: string
  campaignId: string
  campaignName: string
  impressions: number
  clicks: number
  adCost: number
  ctr: number
  orders1d: number
  revenue1d: number
  roas1d: number
  workspaceId: string
} {
  return {
    date: PERIOD_START,
    adType: 'KEYWORD',
    campaignId,
    campaignName: `캠페인-${campaignId}`,
    impressions: 100,
    clicks: 10,
    adCost: 5000,
    ctr: 0.1,
    orders1d: 1,
    revenue1d: 50000,
    roas1d: 10.0,
    workspaceId: WS_ID,
  }
}

async function cleanup() {
  // Workspace는 onDelete: Cascade이므로 하위 레코드 자동 삭제
  await prisma.workspace.deleteMany({ where: { id: WS_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

d('coupang-ads 캠페인 삭제·중복감지 버그 e2e (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-adscampclean@throwaway.test' } })
    await prisma.workspace.create({
      data: { id: WS_ID, ownerId: USER_ID, name: 'E2E AdsCampClean' },
    })

    // resolveWorkspace → throwaway workspace 반환
    ;(resolveWorkspace as jest.Mock).mockResolvedValue({ workspace: { id: WS_ID } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  // ── 테스트 A: 캠페인 DELETE 시 ProductStatus 고아 행 정리 ──
  describe('테스트 A — DELETE 캠페인 시 ProductStatus 함께 삭제', () => {
    const CAMP_A = 'CAMP-DEL-TEST'

    beforeEach(async () => {
      // ReportUpload 시드
      const upload = await prisma.reportUpload.create({
        data: {
          fileName: 'test.xlsx',
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          workspaceId: WS_ID,
        },
      })

      // AdRecord 1건 시드
      await prisma.adRecord.create({
        data: { ...makeAdRecord(CAMP_A), reportId: upload.id },
      })

      // ProductStatus 1건 시드
      await prisma.productStatus.create({
        data: {
          workspaceId: WS_ID,
          campaignId: CAMP_A,
          productName: '테스트상품',
          optionId: 'OPT-001',
        },
      })
    })

    afterEach(async () => {
      // 각 테스트 후 CAMP_A 데이터 정리(cascade 외 잔여물 방지)
      await prisma.productStatus.deleteMany({ where: { workspaceId: WS_ID, campaignId: CAMP_A } })
      await prisma.adRecord.deleteMany({ where: { workspaceId: WS_ID, campaignId: CAMP_A } })
      await prisma.reportUpload.deleteMany({ where: { workspaceId: WS_ID } })
    })

    test('DELETE 호출 후 ProductStatus가 0건이어야 함', async () => {
      // route 핸들러 동적 import (mock 이후 로드해야 mock 적용됨)
      const routeModule = await import('../../../../app/api/campaigns/[campaignId]/route')
      const handler = routeModule.DELETE

      // handler가 export되지 않은 경우 테스트를 건너뜀
      if (!handler) {
        throw new Error('DELETE handler not exported from route module')
      }

      const req = new NextRequest('http://localhost/api/campaigns/' + CAMP_A, { method: 'DELETE' })
      const response = (await handler(req, { params: Promise.resolve({ campaignId: CAMP_A }) }))!

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.deleted.productStatuses).toBeGreaterThanOrEqual(1)

      // ProductStatus 고아 행이 남아있지 않아야 함
      const remaining = await prisma.productStatus.count({
        where: { workspaceId: WS_ID, campaignId: CAMP_A },
      })
      expect(remaining).toBe(0)
    })
  })

  // ── 테스트 B: 중복 감지 오탐 방지 ──
  describe('테스트 B — 중복 감지가 다른 캠페인을 오탐하지 않음', () => {
    const CAMP_B = 'CAMP-EXISTING'
    const CAMP_A_NEW = 'CAMP-NEW-UPLOAD'

    beforeEach(async () => {
      // CAMP-B의 AdRecord를 기간 T에 시드 (업로드 파일과 무관한 캠페인)
      const upload = await prisma.reportUpload.create({
        data: {
          fileName: 'camp-b.xlsx',
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          workspaceId: WS_ID,
        },
      })
      await prisma.adRecord.create({
        data: { ...makeAdRecord(CAMP_B), reportId: upload.id },
      })
    })

    afterEach(async () => {
      await prisma.adRecord.deleteMany({ where: { workspaceId: WS_ID } })
      await prisma.reportUpload.deleteMany({ where: { workspaceId: WS_ID } })
    })

    test('CAMP-A 업로드 시 CAMP-B 존재 때문에 requiresConfirmation이 뜨지 않아야 함', async () => {
      // parseExcelBuffer mock: CAMP-A 행만 반환
      const mockRows: ParsedRow[] = [
        {
          date: PERIOD_START,
          adType: 'KEYWORD',
          campaignId: CAMP_A_NEW,
          campaignName: '신규캠페인',
          adGroup: '',
          placement: '',
          productName: '상품A',
          optionId: 'OPT-A',
          keyword: '키워드',
          impressions: 200,
          clicks: 20,
          adCost: 10000,
          ctr: 0.1,
          orders1d: 2,
          revenue1d: 100000,
          roas1d: 10.0,
          material: null,
          videoViews3s: null,
          avgPlayTime: null,
          videoViews25p: null,
          videoViews50p: null,
          videoViews75p: null,
          videoViews100p: null,
          costPerView3s: null,
          engagements: null,
          engagementRate: null,
        },
      ]
      ;(parseExcelBuffer as jest.Mock).mockReturnValue(mockRows)
      ;(detectPeriod as jest.Mock).mockReturnValue({
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      })

      // overwrite=null로 호출 — 중복 감지 단계
      const result = await processUpload({
        workspaceId: WS_ID,
        fileName: 'camp-a.xlsx',
        buffer: new ArrayBuffer(1),
        overwrite: null,
      })

      // CAMP-A는 DB에 없으므로 requiresConfirmation이 아니어야 함
      if (!result.success && 'requiresConfirmation' in result) {
        // 이 분기에 오면 테스트 실패 — 오탐 발생
        expect(result.requiresConfirmation).toBe(false)
      } else {
        // success:true 또는 다른 결과 — 오탐 없음 확인
        expect(
          'requiresConfirmation' in result &&
            (result as { requiresConfirmation: boolean }).requiresConfirmation
        ).toBeFalsy()
      }
    })
  })
})
