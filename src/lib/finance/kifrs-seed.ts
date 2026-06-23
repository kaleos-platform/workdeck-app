/**
 * 재무 관리 Deck — K-IFRS 표준 계정과목 시드.
 * Space에 finance Deck 활성화 시 1회 시드(멱등). 사용자는 이후 하위계정을 추가한다.
 *
 * 현금주의 모델:
 *  - INCOME/EXPENSE = 현금흐름 분류 타깃(거래 자동분류 대상)
 *  - ASSET/LIABILITY = 재무상태(계좌잔고·부채) 매핑용
 *  - TRANSFER = 계좌간 이체(수입/지출 집계 제외)
 * 키워드(kw)는 SEED 분류 규칙(KEYWORD 매칭, 저신뢰=검토 제안)으로 함께 등록된다.
 */
import { prisma } from '@/lib/prisma'
import type { FinCategoryType } from '@/generated/prisma/enums'

/** 적요/가맹점/키워드 정규화 — 공백 정리 + 소문자(라틴 가맹점 대비). */
export function normalizeFinKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

type SeedChild = {
  name: string
  code: string
  alias?: string
  groupLabel?: string
  /** SEED 분류 규칙으로 등록할 키워드 */
  kw?: string[]
}

type SeedRoot = {
  type: FinCategoryType
  name: string
  code: string
  children: SeedChild[]
}

/** K-IFRS 참고 표준 계정과목 (이커머스 셀러 기준). */
export const KIFRS_CHART: SeedRoot[] = [
  {
    type: 'ASSET',
    name: '자산',
    code: '1000',
    children: [
      { name: '현금및현금성자산', code: '1100', alias: '보유현금' },
      { name: '매출채권', code: '1130' },
      { name: '재고자산', code: '1200', alias: '상품재고' },
    ],
  },
  {
    type: 'LIABILITY',
    name: '부채',
    code: '2000',
    children: [
      { name: '매입채무', code: '2100' },
      { name: '단기차입금', code: '2300', alias: '운전자금대출' },
      { name: '미지급금(카드)', code: '2310', alias: '카드미결제' },
    ],
  },
  {
    type: 'INCOME',
    name: '수익',
    code: '4000',
    children: [
      {
        name: '상품매출',
        code: '4100',
        groupLabel: '매출',
        kw: ['스마트스토어', '쿠팡', '11번가', '정산입금', '네이버페이'],
      },
      { name: '배송비수익', code: '4200', groupLabel: '매출', kw: ['배송비', '운임수익'] },
      { name: '이자수익', code: '4900', groupLabel: '영업외수익', kw: ['이자수익'] },
      { name: '잡이익', code: '4910', groupLabel: '영업외수익' },
    ],
  },
  {
    type: 'EXPENSE',
    name: '비용',
    code: '5000',
    children: [
      {
        name: '상품매입(매출원가)',
        code: '5100',
        groupLabel: '변동비',
        kw: ['매입', '사입', '도매', '소싱'],
      },
      {
        name: '지급수수료',
        code: '5200',
        groupLabel: '판매채널비',
        kw: ['pg', '판매수수료', '정산수수료', '토스페이먼츠', '수수료'],
      },
      {
        name: '운반비(택배)',
        code: '5210',
        groupLabel: '판매채널비',
        kw: ['택배', '한진', 'cj대한통운', '대성물류', '풀필먼트', '3pl'],
      },
      {
        name: '광고선전비',
        code: '5300',
        groupLabel: '마케팅비',
        kw: ['광고', '메타', 'facebk', '페이먼트', 'ad', '마케팅'],
      },
      { name: '급여', code: '5400', groupLabel: '고정비', kw: ['급여', '급여이체', '임금'] },
      { name: '임차료', code: '5410', groupLabel: '고정비', kw: ['임대료', '임차', '월세'] },
      {
        name: '세금과공과',
        code: '5420',
        groupLabel: '고정비',
        kw: ['세금', '공과금', '국세', '지방세', '4대보험'],
      },
      { name: '통신비', code: '5430', groupLabel: '고정비', kw: ['통신', '인터넷', '요금'] },
      {
        name: '소모품비',
        code: '5440',
        groupLabel: '기타운영비',
        kw: ['소모품', '비품', '문구'],
      },
      {
        name: '복리후생비',
        code: '5450',
        groupLabel: '고정비',
        kw: ['복리후생', '간식', '식대', '경조사'],
      },
      {
        name: '지급이자',
        code: '5500',
        groupLabel: '금융비용',
        kw: ['대출이자', '이자', '원리금'],
      },
    ],
  },
  {
    type: 'TRANSFER',
    name: '계좌간 이체',
    code: '9000',
    children: [{ name: '계좌간 이체', code: '9100', kw: ['이체', '대체', '내부이체'] }],
  },
]

/**
 * Space에 K-IFRS 표준 계정과목 + SEED 분류 규칙을 시드한다(멱등).
 * 이미 존재하는 계정과목/규칙은 건너뛴다.
 */
export async function seedFinanceCategories(spaceId: string): Promise<void> {
  let rootOrder = 0
  for (const root of KIFRS_CHART) {
    const rootRow = await upsertCategory(spaceId, null, {
      name: root.name,
      code: root.code,
      type: root.type,
      sortOrder: rootOrder++,
    })

    let childOrder = 0
    for (const child of root.children) {
      const childRow = await upsertCategory(spaceId, rootRow.id, {
        name: child.name,
        code: child.code,
        alias: child.alias ?? null,
        type: root.type,
        groupLabel: child.groupLabel ?? null,
        sortOrder: childOrder++,
      })

      for (const keyword of child.kw ?? []) {
        await upsertSeedRule(spaceId, childRow.id, keyword)
      }
    }
  }
}

async function upsertCategory(
  spaceId: string,
  parentId: string | null,
  data: {
    name: string
    code: string
    type: FinCategoryType
    alias?: string | null
    groupLabel?: string | null
    sortOrder: number
  }
): Promise<{ id: string }> {
  const existing = await prisma.finCategory.findFirst({
    where: { spaceId, parentId, name: data.name },
    select: { id: true },
  })
  if (existing) return existing
  return prisma.finCategory.create({
    data: {
      spaceId,
      parentId,
      name: data.name,
      code: data.code,
      alias: data.alias ?? null,
      type: data.type,
      groupLabel: data.groupLabel ?? null,
      isSystem: true,
      sortOrder: data.sortOrder,
    },
    select: { id: true },
  })
}

async function upsertSeedRule(spaceId: string, categoryId: string, keyword: string): Promise<void> {
  const matchKey = normalizeFinKey(keyword)
  if (!matchKey) return
  const existing = await prisma.finClassRule.findUnique({
    where: { spaceId_matchKey: { spaceId, matchKey } },
    select: { id: true },
  })
  if (existing) return
  await prisma.finClassRule.create({
    data: {
      spaceId,
      matchKey,
      matchType: 'KEYWORD',
      categoryId,
      learnedFrom: 'SEED',
    },
  })
}
