/**
 * 재무 관리 Deck — 학습 기반(결정적) 거래 자동 분류 엔진.
 *
 * 현금주의 모델에서 거래는 적요/상대(은행) 또는 가맹점명(카드)으로 계정과목에 매핑된다.
 * LLM 미사용 — FinClassRule(EXACT/KEYWORD) 규칙 매칭만 사용한다.
 *
 *   - EXACT  매칭(정규화 적요 전체 일치)  → CLASSIFIED (확정)
 *   - KEYWORD 매칭(부분 포함)            → REVIEW     (검토 제안)
 *   - 무매칭                              → UNCLASSIFIED
 *
 * 신뢰도 % 는 저장/표시하지 않는다(상태만). 사용자가 분류를 수정하면 learnRule 로
 * EXACT 규칙을 학습해 동일 적요를 다음부터 자동 분류한다.
 */
import { prisma } from '@/lib/prisma'
import { normalizeFinKey } from '@/lib/finance/kifrs-seed'
import type {
  FinClassRuleMatchType,
  FinClassStatus,
  FinTxnDirection,
} from '@/generated/prisma/enums'
import { fixedSectionOf } from '@/lib/finance/contra'

export { ruleMatchesText } from '@/lib/finance/classify-core'
import type { MatchText } from '@/lib/finance/rule-usage'
import { categoryLabelOf } from '@/lib/finance/category-options'

/** 매칭에 필요한 규칙 최소 형태 */
export type ClassRuleLite = {
  id: string
  matchKey: string
  matchType: FinClassRuleMatchType
  categoryId: string
  /** 방향 구분 — null = 방향 무관(이체/시드), IN/OUT = 해당 방향 전용 */
  direction: FinTxnDirection | null
  /** 규칙 학습 시 저장한 메모 — 자동분류(확정) 시 행 memo로 복사 */
  memo: string | null
  /** 적용 계좌 — null = 전체 계좌 공통 */
  accountId: string | null
}

export type ClassifyInput = {
  description?: string | null
  counterparty?: string | null
}

export type ClassifyResult = {
  categoryId: string | null
  classStatus: FinClassStatus
  matchedRuleId: string | null
  /** 매칭 규칙의 메모(무매칭 null). 소비처는 CLASSIFIED(확정)일 때만 행에 복사한다. */
  ruleMemo: string | null
}

/**
 * Space의 모든 분류 규칙을 로드한다(임포트 1회 분류 시 1번만 호출해 재사용).
 * 계정 섹션과 반대 방향 규칙(OUT→수익, IN→비용 = 환불)은 자동분류에 쓰지 않는다 — 환불은 예외 거래라
 * 같은 적요의 정상 거래까지 환불로 자동 분류되면 수입/지출이 조용히 줄어든다(PR #331 오분류 경로).
 */
export async function loadSpaceRules(spaceId: string): Promise<ClassRuleLite[]> {
  const rules = await prisma.finClassRule.findMany({
    where: { spaceId },
    select: {
      id: true,
      matchKey: true,
      matchType: true,
      categoryId: true,
      direction: true,
      memo: true,
      accountId: true,
      category: { select: { type: true } },
    },
  })
  return rules
    .filter((r) => {
      const fixed = fixedSectionOf(r.category)
      return !r.direction || !fixed || r.direction === fixed
    })
    .map((r) => ({
      id: r.id,
      matchKey: r.matchKey,
      matchType: r.matchType,
      categoryId: r.categoryId,
      direction: r.direction,
      memo: r.memo,
      accountId: r.accountId,
    }))
}

/** 적요 + 상대를 합쳐 정규화한 매칭 대상 텍스트. */
function buildMatchText(input: ClassifyInput): string {
  return normalizeFinKey([input.description ?? '', input.counterparty ?? ''].join(' '))
}

/**
 * 규칙 집합으로 입력을 분류한다(결정적·순수 함수).
 * 우선순위: EXACT(계좌) > EXACT(공통) > KEYWORD(계좌) > KEYWORD(공통) — 일치 정확도가 계좌 범위보다 먼저.
 * 같은 단계 안에서는 방향-특정 > 방향무관(null), KEYWORD 는 가장 긴 matchKey.
 * 다른 계좌 전용 규칙·반대 방향 전용 규칙은 매칭하지 않는다. accountId 생략 시 공통 규칙만.
 */
export function classifyRow(
  input: ClassifyInput,
  rules: ClassRuleLite[],
  direction: FinTxnDirection,
  accountId: string | null = null
): ClassifyResult {
  const text = buildMatchText(input)
  if (!text) return NO_MATCH
  const own = accountId ? rules.filter((r) => r.accountId === accountId) : []
  const common = rules.filter((r) => (r.accountId ?? null) === null)

  const exact = pickExact(own, text, direction) ?? pickExact(common, text, direction)
  if (exact) return matched(exact, 'CLASSIFIED')
  const keyword = pickKeyword(own, text, direction) ?? pickKeyword(common, text, direction)
  if (keyword) return matched(keyword, 'REVIEW')
  return NO_MATCH
}

const NO_MATCH: ClassifyResult = {
  categoryId: null,
  classStatus: 'UNCLASSIFIED',
  matchedRuleId: null,
  ruleMemo: null,
}

function matched(rule: ClassRuleLite, classStatus: FinClassStatus): ClassifyResult {
  return { categoryId: rule.categoryId, classStatus, matchedRuleId: rule.id, ruleMemo: rule.memo }
}

/** EXACT 후보 — 방향-특정 우선, 없으면 방향무관. */
function pickExact(rules: ClassRuleLite[], text: string, direction: FinTxnDirection) {
  let any: ClassRuleLite | null = null
  for (const r of rules) {
    if (r.matchType !== 'EXACT' || r.matchKey !== text) continue
    if (r.direction === direction) return r
    if (r.direction === null && !any) any = r
  }
  return any
}

/** KEYWORD 후보 — 방향-특정 우선, 각각 가장 긴(구체적) 키워드. */
function pickKeyword(rules: ClassRuleLite[], text: string, direction: FinTxnDirection) {
  let specific: ClassRuleLite | null = null
  let any: ClassRuleLite | null = null
  for (const r of rules) {
    if (r.matchType !== 'KEYWORD' || !r.matchKey || !text.includes(r.matchKey)) continue
    if (r.direction === direction) {
      if (!specific || r.matchKey.length > specific.matchKey.length) specific = r
    } else if (r.direction === null) {
      if (!any || r.matchKey.length > any.matchKey.length) any = r
    }
  }
  return specific ?? any
}

/**
 * 사용자 분류를 그 거래 계좌 전용 EXACT 규칙으로 학습한다(같은 계좌·적요·방향 다음부터 자동 분류).
 * 키 (spaceId, accountId, matchKey, direction) — 다른 계좌의 같은 적요 규칙은 건드리지 않는다.
 * 같은 키 규칙이 있으면 계정과목을 갱신(사용자 정정 우선)하고 이전 계정과목을 돌려준다(덮어쓰기 알림용).
 * memo: undefined=기존 유지, null=삭제, string=설정 (memo 미전달 호출부가 규칙 메모를 지우지 않도록).
 * 반환 null: 적요가 비었거나 환불 방향(학습 제외).
 */
export async function learnRule(
  spaceId: string,
  input: ClassifyInput,
  categoryId: string,
  direction: FinTxnDirection,
  accountId: string,
  memo?: string | null
): Promise<{ ruleId: string; previousCategoryId: string | null } | null> {
  const matchKey = buildMatchText(input)
  if (!matchKey) return null

  // 환불(계정 섹션과 반대 방향) 분류는 학습하지 않는다 — loadSpaceRules 주석 참고.
  const category = await prisma.finCategory.findUnique({
    where: { id: categoryId },
    select: { type: true },
  })
  const fixed = fixedSectionOf(category)
  if (fixed && fixed !== direction) return null

  const key = { spaceId, accountId, matchKey, direction }
  return prisma.$transaction(async (tx) => {
    const prev = await tx.finClassRule.findUnique({
      where: { spaceId_accountId_matchKey_direction: key },
      select: { categoryId: true },
    })
    const rule = await tx.finClassRule.upsert({
      where: { spaceId_accountId_matchKey_direction: key },
      update: {
        categoryId,
        matchType: 'EXACT',
        learnedFrom: 'USER',
        ...(memo !== undefined ? { memo } : {}),
      },
      create: { ...key, categoryId, matchType: 'EXACT', learnedFrom: 'USER', memo: memo ?? null },
      select: { id: true },
    })
    return {
      ruleId: rule.id,
      previousCategoryId: prev && prev.categoryId !== categoryId ? prev.categoryId : null,
    }
  })
}

/**
 * 분류 결과를 스테이징 행 필드로 — 업로드·규칙 수정/삭제 재분류 공용.
 * 행 메모가 있으면 유지, 없을 때만 규칙 메모를 쓰고 규칙 메모는 확정(EXACT) 자동분류에만 복사한다
 * (REVIEW 는 제안 단계라 미복사).
 */
export function stagedClassificationPatch(cls: ClassifyResult, currentMemo: string | null) {
  return {
    categoryId: cls.categoryId,
    classStatus: cls.classStatus,
    matchedRuleId: cls.matchedRuleId,
    memo: currentMemo ?? (cls.classStatus === 'CLASSIFIED' ? (cls.ruleMemo ?? null) : null),
  }
}

/** 확정 거래의 매칭 텍스트(사용 현황·미리보기·일괄 변경 대상 계산용). accountId 지정 시 그 계좌만. */
export async function loadMatchTexts(
  spaceId: string,
  accountId?: string | null
): Promise<MatchText[]> {
  const rows = await prisma.finTransaction.findMany({
    where: { spaceId, ...(accountId ? { accountId } : {}) },
    select: {
      id: true,
      accountId: true,
      direction: true,
      description: true,
      counterparty: true,
      txnDate: true,
      categoryId: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    direction: r.direction,
    text: buildMatchText(r),
    txnDate: r.txnDate,
    categoryId: r.categoryId,
  }))
}

/**
 * 규칙 수정·삭제 후 확인·처리 대기(DRAFT) 행 재분류. 대상: 이 규칙으로 분류됐던 행 +
 * 미분류·검토 행(수정된 규칙이 새로 걸릴 수 있음). 결과가 그대로인 행은 쓰지 않는다.
 * 사용자가 직접 분류한 CLASSIFIED 행(다른 규칙 매칭분)은 대상이 아니다.
 */
export async function reclassifyDraftStagedRows(spaceId: string, ruleId: string): Promise<number> {
  const rows = await prisma.finStagedRow.findMany({
    where: {
      spaceId,
      import: { status: 'DRAFT' },
      OR: [{ matchedRuleId: ruleId }, { classStatus: { in: ['UNCLASSIFIED', 'REVIEW'] } }],
    },
    select: {
      id: true,
      accountId: true,
      direction: true,
      description: true,
      counterparty: true,
      memo: true,
      matchedRuleId: true,
      categoryId: true,
      classStatus: true,
    },
  })
  if (rows.length === 0) return 0
  const rules = await loadSpaceRules(spaceId)
  let changed = 0
  for (const r of rows) {
    const cls = classifyRow(r, rules, r.direction, r.accountId)
    const same =
      r.matchedRuleId !== ruleId &&
      cls.matchedRuleId === r.matchedRuleId &&
      cls.categoryId === r.categoryId &&
      cls.classStatus === r.classStatus
    if (same) continue
    await prisma.finStagedRow.update({
      where: { id: r.id },
      data: stagedClassificationPatch(cls, r.memo),
    })
    changed++
  }
  return changed
}

export type RuleNotice = {
  /** REPLACED: 이 계좌의 같은 키 규칙을 덮어씀 / OVERRIDES: 다른 규칙(공통·부분포함) 대신 새 규칙이 적용됨 */
  kind: 'REPLACED' | 'OVERRIDES'
  fromCategoryId: string
  fromLabel: string
}

/**
 * 학습 직전 알림 — 지금 이 거래에 실제 적용되는 규칙(classifyRow) 기준.
 * 계좌 전용 학습이 되면 흔한 경우는 같은 키 덮어쓰기가 아니라 다른 계정과목의 공통 규칙을
 * 새 계좌 규칙이 앞지르는 것이라, 같은 키 조회가 아니라 매칭 결과로 판단한다.
 * 적용 규칙이 없거나 같은 계정과목이면 null.
 */
export async function ruleNoticeFor(
  spaceId: string,
  input: ClassifyInput,
  direction: FinTxnDirection,
  accountId: string,
  categoryId: string
): Promise<RuleNotice | null> {
  // 환불(계정 섹션과 반대 방향) 분류는 learnRule 이 학습하지 않으므로 알릴 변화도 없다.
  const target = await prisma.finCategory.findUnique({
    where: { id: categoryId },
    select: { type: true },
  })
  const fixed = fixedSectionOf(target)
  if (fixed && fixed !== direction) return null

  const rules = await loadSpaceRules(spaceId)
  const cls = classifyRow(input, rules, direction, accountId)
  if (!cls.matchedRuleId || !cls.categoryId || cls.categoryId === categoryId) return null
  const rule = rules.find((r) => r.id === cls.matchedRuleId)
  if (!rule) return null
  const sameKey =
    rule.accountId === accountId &&
    rule.matchType === 'EXACT' &&
    rule.direction === direction &&
    rule.matchKey === buildMatchText(input)
  const cat = await prisma.finCategory.findUnique({
    where: { id: cls.categoryId },
    select: { name: true, parent: { select: { name: true } } },
  })
  return {
    kind: sameKey ? 'REPLACED' : 'OVERRIDES',
    fromCategoryId: cls.categoryId,
    fromLabel: categoryLabelOf(cat),
  }
}

/** 적요+상대를 정규화한 매칭 키(외부에서 sibling 계산 등에 재사용). */
export function matchKeyOf(input: ClassifyInput): string {
  return buildMatchText(input)
}
