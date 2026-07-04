/**
 * 재무 관리 Deck — 소규모 브랜드용 "운영 계정 차트" 시드.
 * Space에 finance Deck 활성화 시 1회 시드(멱등). 사용자는 이후 항목을 추가/제거한다.
 *
 * 설계 전환(2026-06):
 *  - 사용자 전면 = 운영 계정 항목(쉬운 비즈니스 언어). 2단계 트리 = 대분류 → 운영 항목.
 *  - K-IFRS는 각 운영 항목의 배경 매핑(`code`)으로만 보존 → 공식 회계 export 시에만 노출.
 *  - 현금주의: INCOME/EXPENSE = 현금흐름 분류 타깃(거래 자동분류 대상),
 *    ASSET/LIABILITY = 재무상태(계좌잔고·부채) 매핑용(분류 타깃 아님),
 *    TRANSFER = 계좌간 이체·카드대금 납부(수입/지출 집계 제외 net-off).
 *  - 영업/투자/재무 현금흐름 재분류는 export에서만 — `KIFRS_CF_MAP`(code→활동)으로 유도.
 *
 * 제거 가능성: 루트(구분)만 isSystem=true로 보호. 대분류·모든 리프(수입/지출·자산/부채·이체)는
 *  isSystem=false → 사용자가 이름변경·삭제 가능. net-off 불변식은 category.type==='TRANSFER'
 *  기준이라(분류 시 isTransfer 설정) 이체 항목의 이름변경·삭제와 무관 — 인스턴스가 아니라 타입이 보장.
 * 키워드(kw)는 검색/AI 컨텍스트용 — `opts.withRules`가 true일 때만 SEED 분류 규칙으로 등록(기본 false).
 */
import { prisma } from '@/lib/prisma'
import type { FinCategoryType, FinTxnDirection, FinFlowRole } from '@/generated/prisma/enums'

/** 적요/가맹점/키워드 정규화 — 공백 정리 + 소문자(라틴 가맹점 대비). */
export function normalizeFinKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

// K-IFRS 매핑(현금흐름 활동·공식 계정명)은 client-safe 모듈로 분리 — 여기서 re-export해 서버 import 경로 유지.
export {
  KIFRS_CF_MAP,
  cfActivityForCode,
  CF_ACTIVITY_LABEL,
  KIFRS_ACCOUNT_NAMES,
  KIFRS_ACCOUNT_OPTIONS,
  kifrsAccountName,
} from './kifrs-map'
export type { CfActivity } from './kifrs-map'

type SeedNode = {
  name: string
  /** 매핑 K-IFRS 코드(운영 항목/매핑 항목에만). 대분류 그룹은 생략. */
  code?: string
  alias?: string
  /** 고정/변동 원가 성격 → FinCategory.groupLabel (비용관리 축). */
  costNature?: '고정' | '변동'
  /** 손익 흐름도 역할 → FinCategory.flowRole (대분류에만 지정). */
  flowRole?: FinFlowRole
  /** 검색·AI 컨텍스트용 키워드(withRules=true일 때만 규칙 등록). */
  kw?: string[]
  /** 하위 노드(있으면 구조 그룹, 없으면 리프). */
  children?: SeedNode[]
}

type SeedRoot = {
  type: FinCategoryType
  name: string
  code: string
  children: SeedNode[]
}

/**
 * 소규모 이커머스 브랜드 기준 기본 운영 계정 차트.
 * INCOME/EXPENSE = 대분류(level1) → 운영 항목(level2, 제거 가능).
 * ASSET/LIABILITY = 잔고·부채 매핑 항목(분류 타깃 아님).
 * TRANSFER = 이체·카드납부(net-off).
 */
export const OPERATIONAL_CHART: SeedRoot[] = [
  {
    type: 'INCOME',
    name: '수입',
    code: '4000',
    children: [
      {
        name: '매출',
        flowRole: 'MERCH_SALES',
        children: [
          {
            name: '온라인 판매정산',
            code: '4100',
            kw: ['스마트스토어', '쿠팡', '11번가', '정산입금', '네이버페이'],
          },
          { name: '도매·B2B 매출', code: '4100', kw: ['도매', 'b2b', '거래처입금'] },
        ],
      },
      {
        name: '기타수입',
        children: [
          { name: '정부지원금', code: '4910', kw: ['지원금', '보조금', '지원사업'] },
          { name: '이자·금융수입', code: '4900', kw: ['이자수익', '예금이자'] },
          { name: '기타수입', code: '4910', kw: [] },
        ],
      },
    ],
  },
  {
    type: 'EXPENSE',
    name: '지출',
    code: '5000',
    children: [
      {
        name: '상품원가',
        flowRole: 'COGS',
        children: [
          {
            name: '상품 매입·사입',
            code: '5100',
            costNature: '변동',
            kw: ['매입', '사입', '도매', '소싱'],
          },
        ],
      },
      {
        name: '물류·배송',
        flowRole: 'OPEX',
        children: [
          {
            name: '택배비',
            code: '5210',
            costNature: '변동',
            kw: ['택배', '한진', 'cj대한통운', '대성물류'],
          },
          {
            name: '풀필먼트·창고',
            code: '5210',
            costNature: '변동',
            kw: ['풀필먼트', '3pl', '창고'],
          },
          { name: '포장·부자재', code: '5440', costNature: '변동', kw: ['포장', '부자재', '박스'] },
        ],
      },
      {
        name: '판매·결제 수수료',
        flowRole: 'OPEX',
        children: [
          {
            name: '판매채널 수수료',
            code: '5200',
            costNature: '변동',
            kw: ['판매수수료', '정산수수료', '채널수수료'],
          },
          {
            name: '결제대행 PG',
            code: '5200',
            costNature: '변동',
            kw: ['pg', '토스페이먼츠', '결제대행'],
          },
        ],
      },
      {
        name: '마케팅·광고',
        flowRole: 'OPEX',
        children: [
          {
            name: '광고비',
            code: '5300',
            costNature: '변동',
            // 'ad'는 너무 짧아 오탐(load·adidas 등) — 제외.
            kw: ['광고', '메타', 'facebk', '마케팅'],
          },
          { name: '콘텐츠·제작', code: '5300', costNature: '변동', kw: ['콘텐츠', '제작', '촬영'] },
        ],
      },
      {
        name: '인건비',
        flowRole: 'OPEX',
        children: [
          { name: '급여', code: '5400', costNature: '고정', kw: ['급여', '급여이체', '임금'] },
          {
            name: '4대보험·인건비성 세금',
            code: '5420',
            costNature: '고정',
            kw: ['4대보험', '국민연금', '건강보험', '고용보험'],
          },
          {
            name: '복리후생·식대',
            code: '5450',
            costNature: '고정',
            kw: ['복리후생', '식대', '간식', '경조사'],
          },
        ],
      },
      {
        name: '업무지원·외주',
        flowRole: 'OPEX',
        children: [
          { name: '세무·회계', code: '5200', costNature: '고정', kw: ['세무', '회계', '기장'] },
          {
            name: '소프트웨어·구독',
            code: '5200',
            costNature: '고정',
            kw: ['소프트웨어', '구독', 'saas', '솔루션'],
          },
          // '인터넷'(인터넷뱅킹)·'요금'(전기/수도/가스요금)은 오탐 — 통신 특정어만.
          { name: '통신비', code: '5430', costNature: '고정', kw: ['통신', '휴대폰', '통신요금'] },
          { name: '외주·용역', code: '5200', costNature: '변동', kw: ['외주', '용역', '대행'] },
        ],
      },
      {
        name: '사무·운영',
        flowRole: 'OPEX',
        children: [
          { name: '임차료', code: '5410', costNature: '고정', kw: ['임대료', '임차', '월세'] },
          { name: '소모품·비품', code: '5440', costNature: '변동', kw: ['소모품', '비품', '문구'] },
          {
            name: '여비·교통',
            code: '5440',
            costNature: '변동',
            kw: ['교통', '주유', '택시', '여비'],
          },
          { name: '식사·접대', code: '5450', costNature: '변동', kw: ['식사', '접대', '음료'] },
        ],
      },
      {
        name: '세금·공과',
        flowRole: 'OPEX',
        children: [
          {
            name: '세금·공과금',
            code: '5420',
            costNature: '고정',
            kw: ['세금', '공과금', '국세', '지방세'],
          },
        ],
      },
      {
        name: '금융비용',
        flowRole: 'FINANCING_COST',
        children: [
          {
            name: '대출이자',
            code: '5500',
            costNature: '고정',
            kw: ['대출이자', '이자', '원리금'],
          },
        ],
      },
      {
        name: '투자·자산취득',
        children: [
          {
            name: '설비·자산취득',
            code: '1500',
            kw: ['설비', '비품구입', '부동산', '투자'],
          },
          { name: '정부지원 자부담', code: '5440', kw: ['자부담', '매칭펀드'] },
        ],
      },
    ],
  },
  {
    type: 'TRANSFER',
    name: '이체·조정',
    code: '9000',
    children: [
      // "이체"·"대체"는 너무 광범위(급여이체·타행이체·국고이체 등 오추천) — 내부이체는
      // 적요만으론 외부 지급과 구분 불가하므로 명시 라벨만 키워드로(나머지는 사용자/AI 판단).
      { name: '계좌간 이체', code: '9100', kw: ['내부이체'] },
      // 카드 사용 시 5000번대 비용이 먼저 잡히므로, 납부는 부채(미지급금) 감소로만 처리(이중지출 방지).
      { name: '신용카드 대금 납부', code: '2310', kw: ['카드대금', '카드결제대금', '카드청구'] },
    ],
  },
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
]

/**
 * 운영 차트의 리프(운영 항목) 중 키워드(kw)가 있는 것을 평탄화한다.
 * 룰베이스(키워드) 추천에서 사용 — 시드 kw는 규칙으로 영속화하지 않으므로(정책) 추천 시점에만 쓴다.
 */
export function flattenOperationalLeaves(): {
  name: string
  type: FinCategoryType
  kw: string[]
}[] {
  const out: { name: string; type: FinCategoryType; kw: string[] }[] = []
  const walk = (nodes: SeedNode[], type: FinCategoryType): void => {
    for (const n of nodes) {
      const isLeaf = !n.children || n.children.length === 0
      if (isLeaf) {
        if (n.kw && n.kw.length > 0) out.push({ name: n.name, type, kw: n.kw })
      } else {
        walk(n.children!, type)
      }
    }
  }
  for (const root of OPERATIONAL_CHART) walk(root.children, root.type)
  return out
}

/**
 * Space에 운영 계정 차트를 시드한다(멱등). 이미 존재하는 항목은 건너뛴다.
 *
 * 정책: 운영 항목(INCOME/EXPENSE 리프)은 isSystem=false(제거 가능)로 시드.
 * 자동분류 규칙(FinClassRule)은 사용자가 직접 구축/AI 제안으로 학습하는 것을 기본으로 하므로
 * 키워드 규칙은 `opts.withRules`가 true일 때만 등록한다(기본 false).
 */
export async function seedFinanceCategories(
  spaceId: string,
  opts: { withRules?: boolean } = {}
): Promise<void> {
  const { withRules = false } = opts

  let rootOrder = 0
  for (const root of OPERATIONAL_CHART) {
    const rootRow = await upsertCategory(spaceId, null, {
      name: root.name,
      code: root.code,
      type: root.type,
      isSystem: true,
      sortOrder: rootOrder++,
    })
    await seedChildren(spaceId, rootRow.id, root.type, root.children, withRules)
  }
}

/** 재귀: 자식 노드를 시드. 리프(자식 없음)면 운영 항목/매핑 항목, 아니면 구조 그룹. */
async function seedChildren(
  spaceId: string,
  parentId: string,
  rootType: FinCategoryType,
  nodes: SeedNode[],
  withRules: boolean
): Promise<void> {
  let order = 0
  for (const node of nodes) {
    const isLeaf = !node.children || node.children.length === 0
    const row = await upsertCategory(spaceId, parentId, {
      name: node.name,
      code: node.code ?? null,
      alias: node.alias ?? null,
      type: rootType,
      groupLabel: node.costNature ?? null,
      flowRole: node.flowRole ?? null,
      // 루트만 보호. 모든 리프·대분류는 편집·삭제 가능(net-off는 type 기준이라 이체 리프도 안전).
      isSystem: false,
      sortOrder: order++,
    })

    if (isLeaf) {
      if (withRules) {
        for (const keyword of node.kw ?? []) {
          await upsertSeedRule(spaceId, row.id, keyword, directionForType(rootType))
        }
      }
    } else {
      await seedChildren(spaceId, row.id, rootType, node.children!, withRules)
    }
  }
}

/**
 * 활성 finance space에 계정과목이 하나도 없으면(콜드케이스·시드 실패) 운영 차트를 시드해 복구한다.
 * 카테고리 의존 GET에서 호출하면 빈 드롭다운이 자동 복구된다. 멱등이라 반복 호출 안전.
 */
export async function ensureFinanceSeeded(spaceId: string): Promise<void> {
  const count = await prisma.finCategory.count({ where: { spaceId } })
  if (count === 0) await seedFinanceCategories(spaceId)
}

async function upsertCategory(
  spaceId: string,
  parentId: string | null,
  data: {
    name: string
    code: string | null
    type: FinCategoryType
    alias?: string | null
    groupLabel?: string | null
    flowRole?: FinFlowRole | null
    isSystem: boolean
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
      flowRole: data.flowRole ?? null,
      isSystem: data.isSystem,
      sortOrder: data.sortOrder,
    },
    select: { id: true },
  })
}

/** 계정과목 type → 규칙 방향 (INCOME=IN, EXPENSE=OUT, 그 외=null 방향무관). */
export function directionForType(type: FinCategoryType): FinTxnDirection | null {
  if (type === 'INCOME') return 'IN'
  if (type === 'EXPENSE') return 'OUT'
  return null
}

async function upsertSeedRule(
  spaceId: string,
  categoryId: string,
  keyword: string,
  direction: FinTxnDirection | null
): Promise<void> {
  const matchKey = normalizeFinKey(keyword)
  if (!matchKey) return
  // (spaceId, matchKey, direction) 멱등 — nullable 복합 unique upsert 회피 위해 findFirst 사용.
  const existing = await prisma.finClassRule.findFirst({
    where: { spaceId, matchKey, direction },
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
      direction,
    },
  })
}
