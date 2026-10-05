# 자동 분류 규칙 계좌 단위·검색·수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자동 분류 규칙을 계좌 단위로 적용·관리하고, 검색·수정·사용 현황·매칭 미리보기를 제공하며, 규칙 덮어쓰기를 명시적으로 만든다.

**Architecture:** `FinClassRule.accountId`(nullable, null=공통) 추가 + 기존 규칙은 매칭 이력으로 백필. 매칭 엔진 `classifyRow` 에 계좌 인자와 4단계 우선순위를 넣고, 학습은 거래 계좌 전용 upsert. 규칙 API 에 PATCH·preview·lookup 추가, 사용 현황은 텍스트 매칭 기준. UI 는 `class-rules-manager.tsx` 로 분리(좌측 계좌 목록 + 우측 표 + 추가/수정 팝업).

**Tech Stack:** Next.js 16 App Router, Prisma 7(PostgreSQL), React 19 + shadcn/ui, Jest(단위 + dev DB e2e).

**Spec:** `docs/superpowers/specs/2026-10-05-finance-class-rules-by-account-design.md`

## Global Constraints

- 컬럼 `FinClassRule.accountId String?` (FK `FinAccount`, onDelete Cascade), 유일키 `@@unique([spaceId, accountId, matchKey, direction])`, 인덱스 `@@index([spaceId, accountId])`.
- `accountId = null` = 「전체 공통」. 공통·방향무관 규칙 중복은 앱 레벨 `findFirst`(accountId 명시) 검사로 막는다.
- 우선순위: EXACT(계좌) > EXACT(공통) > KEYWORD(계좌) > KEYWORD(공통). 단계 내: 방향 지정 > 방향 무관, KEYWORD 는 긴 키워드.
- 학습(`learnRule`)은 거래/행의 계좌 전용. 규칙 관리 화면 추가·수정 충돌은 409(`errorResponse(message, 409, { existing })` — 응답 키는 `message`).
- 사용 현황·미리보기·「기존 거래 함께 변경」 대상 = **텍스트 매칭** 기준(`matchedRuleId` 기준 금지).
- 스키마 변경은 마이그레이션 파일(`migrate dev` 가 shadow DB 오류면 SQL 수기 + `migrate deploy`). prod 직접 SQL 금지.
- 코드 스타일: 2칸, 작은따옴표, 세미콜론 없음, 한국어 주석. 커밋 `✨ feat(finance): ...` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, 파일 명시 스테이징.

## Review Focus

1. **다른 계좌의 같은 적요가 서로 덮어쓰기** — 계좌 A 에서 학습한 규칙이 계좌 B 학습으로 바뀌면 안 된다. (Task 2 e2e)
2. **옛 3요소 키 조회 잔존** — `accountId` 없이 `finClassRule.findFirst({ spaceId, matchKey, direction })` 를 쓰는 곳이 남으면 공통 시드·수동 규칙이 계좌 규칙과 엉킨다. (Task 2 grep 단계 + e2e)
3. **부분포함 규칙이 「미사용」으로 오표시** — 확인 분류로 `matchedRuleId` 를 잃은 KEYWORD 규칙도 사용 중으로 집계. (Task 3 단위 테스트)
4. **수정 시 기존 거래 일괄 변경 범위 초과** — 이후 사용자가 다른 계정과목으로 바꾼 거래까지 되돌리면 안 된다. (Task 3 e2e)
5. **공통 규칙을 앞지르는 학습이 무음** — 이 계좌 새 규칙이 다른 계정과목의 공통 규칙 대신 적용될 때 알림. (Task 4 e2e)

---

## File Structure

| 파일                                                                                                                      | 책임                                                                | Task       |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------- |
| `src/lib/finance/classify.ts`                                                                                             | 엔진(계좌 4단계), 학습(계좌·알림), 텍스트 매칭, 대기 행 재분류 헬퍼 | 1, 2, 3, 4 |
| `src/lib/finance/rule-usage.ts` (신규, 순수)                                                                              | 규칙별 텍스트 매칭 사용 현황 집계                                   | 3          |
| `prisma/schema.prisma` + 마이그레이션                                                                                     | accountId·유일키·백필                                               | 2          |
| `src/lib/finance/kifrs-seed.ts`, `src/lib/finance/rule-suggest.ts`                                                        | 시드 조회 accountId, 추천 계좌                                      | 2          |
| `app/api/finance/imports/commit-staging/route.ts`, `app/api/finance/staging/route.ts`                                     | 업로드·추천에 계좌 전달, 공용 패치 헬퍼                             | 2          |
| `app/api/finance/staging/[id]/route.ts`, `app/api/finance/transactions/[id]/route.ts`, `src/lib/agent/actions/finance.ts` | 계좌 학습 + 알림                                                    | 2, 4       |
| `app/api/finance/rules/route.ts`, `rules/[id]/route.ts`, `rules/preview/route.ts`(신규), `rules/lookup/route.ts`(신규)    | 규칙 API                                                            | 3, 4       |
| `src/components/finance/class-rules-manager.tsx` (신규)                                                                   | 규칙 관리 UI                                                        | 5          |
| `src/components/finance/accounts-manager.tsx`                                                                             | 기존 RuleManager 제거·교체                                          | 5          |
| `src/components/finance/transactions-view.tsx`, `cashflow-view.tsx`                                                       | 덮어쓰기 경고·토스트                                                | 4          |
| `src/lib/finance/__tests__/classify.test.ts`, `rule-usage.test.ts`(신규), `class-rules-account.e2e.test.ts`(신규)         | 테스트                                                              | 1–4        |

e2e 실행: `npx jest -c jest.config.e2e.ts src/lib/finance/__tests__/class-rules-account.e2e.test.ts` — **passed 수 확인(skipped 0)**.

---

### Task 1: 매칭 엔진 — 계좌 인자 + 4단계 우선순위 + 텍스트 매칭 함수

**Files:**

- Modify: `src/lib/finance/classify.ts` (`ClassRuleLite`, `classifyRow`, `ruleMatchesText` re-export)
- Create: `src/lib/finance/classify-core.ts` (`ruleMatchesText` — prisma 없는 순수 모듈, Task 3 `rule-usage.ts`·클라이언트에서도 import)
- Test: `src/lib/finance/__tests__/classify.test.ts`

**Interfaces:**

- Produces: `ClassRuleLite.accountId: string | null`
- Produces: `classifyRow(input, rules, direction, accountId: string | null = null): ClassifyResult`
- Produces: `ruleMatchesText(rule: Pick<ClassRuleLite,'matchKey'|'matchType'|'direction'>, text: string, direction: FinTxnDirection): boolean`

- [ ] **Step 1: 테스트 헬퍼·실패 테스트**

`classify.test.ts` 의 `rule()` 헬퍼에 7번째 인자 `accountId: string | null = null` 추가하고 반환 객체에 `accountId` 포함. 파일 끝에 추가:

```ts
describe('classifyRow — 계좌 범위', () => {
  test('다른 계좌 전용 규칙은 매칭하지 않음', () => {
    const rules = [rule('a', '쿠팡', 'EXACT', 'cat-a', 'OUT', null, 'acc-A')]
    expect(classifyRow({ description: '쿠팡' }, rules, 'OUT', 'acc-B').categoryId).toBeNull()
  })

  test('EXACT 계좌 > EXACT 공통', () => {
    const rules = [
      rule('common', '쿠팡', 'EXACT', 'cat-common', 'OUT'),
      rule('acct', '쿠팡', 'EXACT', 'cat-acct', 'OUT', null, 'acc-A'),
    ]
    expect(classifyRow({ description: '쿠팡' }, rules, 'OUT', 'acc-A').matchedRuleId).toBe('acct')
  })

  test('EXACT 공통 > KEYWORD 계좌 (일치 정확도 우선)', () => {
    const rules = [
      rule('kw-acct', '쿠', 'KEYWORD', 'cat-kw', 'OUT', null, 'acc-A'),
      rule('exact-common', '쿠팡', 'EXACT', 'cat-exact', 'OUT'),
    ]
    const res = classifyRow({ description: '쿠팡' }, rules, 'OUT', 'acc-A')
    expect(res.matchedRuleId).toBe('exact-common')
    expect(res.classStatus).toBe('CLASSIFIED')
  })

  test('KEYWORD 계좌 > KEYWORD 공통 (공통이 더 길어도)', () => {
    const rules = [
      rule('kw-common', '쿠팡 결제', 'KEYWORD', 'cat-common', 'OUT'),
      rule('kw-acct', '쿠팡', 'KEYWORD', 'cat-acct', 'OUT', null, 'acc-A'),
    ]
    const res = classifyRow({ description: '쿠팡 결제 대금' }, rules, 'OUT', 'acc-A')
    expect(res.matchedRuleId).toBe('kw-acct')
    expect(res.classStatus).toBe('REVIEW')
  })

  test('계좌 인자 생략 시 공통 규칙만', () => {
    const rules = [rule('acct', '쿠팡', 'EXACT', 'cat-acct', 'OUT', null, 'acc-A')]
    expect(classifyRow({ description: '쿠팡' }, rules, 'OUT').categoryId).toBeNull()
  })
})

describe('ruleMatchesText', () => {
  test('EXACT 전체 일치·KEYWORD 포함·반대 방향 제외', () => {
    expect(
      ruleMatchesText({ matchKey: '쿠팡', matchType: 'EXACT', direction: null }, '쿠팡', 'OUT')
    ).toBe(true)
    expect(
      ruleMatchesText({ matchKey: '쿠팡', matchType: 'EXACT', direction: null }, '쿠팡 결제', 'OUT')
    ).toBe(false)
    expect(
      ruleMatchesText(
        { matchKey: '쿠팡', matchType: 'KEYWORD', direction: null },
        '쿠팡 결제',
        'OUT'
      )
    ).toBe(true)
    expect(
      ruleMatchesText(
        { matchKey: '쿠팡', matchType: 'KEYWORD', direction: 'IN' },
        '쿠팡 결제',
        'OUT'
      )
    ).toBe(false)
  })
})
```

import 줄에 `ruleMatchesText` 추가.

- [ ] **Step 2: 실패 확인** — `npx jest src/lib/finance/__tests__/classify.test.ts` → 계좌 테스트·ruleMatchesText FAIL(기존 테스트는 PASS 유지).

- [ ] **Step 3: 구현** — `classify.ts`:

`ClassRuleLite` 에 `/** 적용 계좌 — null = 전체 공통 */ accountId: string | null` 추가. `loadSpaceRules` select·map 에 `accountId` 추가.

`classifyRow` 를 다음으로 교체(주석 갱신):

```ts
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

/** KEYWORD 후보 — 방향-특정 우선, 각각 가장 긴 키워드. */
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

// ↓ 이 함수는 src/lib/finance/classify-core.ts 에 두고 classify.ts 에서 `export { ruleMatchesText } from './classify-core'`
/** 규칙 하나가 정규화 텍스트에 걸리는지(우선순위 무시) — 사용 현황·미리보기용. */
export function ruleMatchesText(
  rule: Pick<ClassRuleLite, 'matchKey' | 'matchType' | 'direction'>,
  text: string,
  direction: FinTxnDirection
): boolean {
  if (rule.direction && rule.direction !== direction) return false
  if (!text || !rule.matchKey) return false
  return rule.matchType === 'EXACT' ? rule.matchKey === text : text.includes(rule.matchKey)
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → 전부 PASS. `npx tsc --noEmit -p .` → `ClassRuleLite` 를 만드는 `rule-suggest.ts` 시드 합성(`accountId` 누락) 에러가 나면 `accountId: null` 추가.

- [ ] **Step 5: 커밋** — `classify.ts`, `classify-core.ts`, `classify.test.ts`, (필요 시) `rule-suggest.ts`. 메시지 `✨ feat(finance): 분류 엔진 계좌 범위 4단계 우선순위`.

---

### Task 2: 스키마·백필 + 계좌 전용 학습 + 호출처 계좌 전달

**Files:**

- Modify: `prisma/schema.prisma` (`FinClassRule`, `FinAccount`)
- Create: `prisma/migrations/20261006100000_fin_class_rule_account/migration.sql`
- Modify: `src/lib/finance/classify.ts` (`learnRule`, 신규 `stagedClassificationPatch`)
- Modify: `src/lib/finance/kifrs-seed.ts` (`upsertSeedRule`), `src/lib/finance/rule-suggest.ts`, `app/api/finance/staging/route.ts`, `app/api/finance/imports/commit-staging/route.ts`, `app/api/finance/staging/[id]/route.ts`, `app/api/finance/transactions/[id]/route.ts`, `app/api/finance/rules/route.ts`(POST findFirst 만), `src/lib/agent/actions/finance.ts`
- Test: `src/lib/finance/__tests__/class-rules-account.e2e.test.ts` (신규)

**Interfaces:**

- Consumes: Task 1 `classifyRow(..., accountId)`
- Produces: `learnRule(spaceId, input, categoryId, direction, accountId: string, memo?) → Promise<{ ruleId: string; previousCategoryId: string | null } | null>`
- Produces: `stagedClassificationPatch(cls: ClassifyResult, currentMemo: string | null) → { categoryId, classStatus, matchedRuleId, memo }`
- Produces: `ruleSuggestionFor(input, direction, ruleset, nameById, accountId: string | null)`

- [ ] **Step 1: 스키마**

`FinClassRule` 에 (memo 아래):

```prisma
  // 적용 계좌 — null = 전체 계좌 공통. 지정 시 그 계좌 거래에만 매칭(분류 시 학습 규칙은 계좌 전용).
  accountId   String?
```

relation 블록에 `account  FinAccount? @relation(fields: [accountId], references: [id], onDelete: Cascade)`.
`@@unique([spaceId, matchKey, direction])` → `@@unique([spaceId, accountId, matchKey, direction])`, `@@index([spaceId, accountId])` 추가.
`FinAccount` 관계 목록에 `classRules       FinClassRule[]`.

- [ ] **Step 2: 마이그레이션 SQL** (`migrate dev` 실패 시 이 파일 수기 + `npx prisma migrate deploy` + `npx prisma generate`)

```sql
-- AlterTable
ALTER TABLE "FinClassRule" ADD COLUMN "accountId" TEXT;

-- 기존 규칙 계좌 백필: 이 규칙으로 분류된(계정과목이 그대로인) 확정 거래가 전부 한 계좌면 그 계좌로.
-- 여러 계좌·이력 없음은 NULL(전체 공통) 유지. 운영 시뮬레이션(2026-10-05): 674 중 557 배정, 다계좌 16, 이력 없음 101.
UPDATE "FinClassRule" r SET "accountId" = s.acc
FROM (
  SELECT t."matchedRuleId" AS rid, MIN(t."accountId") AS acc
  FROM "FinTransaction" t
  JOIN "FinClassRule" r2 ON r2.id = t."matchedRuleId"
  WHERE t."categoryId" = r2."categoryId"
  GROUP BY t."matchedRuleId"
  HAVING COUNT(DISTINCT t."accountId") = 1
) s
WHERE r.id = s.rid;

-- 유일키 교체
DROP INDEX "FinClassRule_spaceId_matchKey_direction_key";
CREATE UNIQUE INDEX "FinClassRule_spaceId_accountId_matchKey_direction_key" ON "FinClassRule"("spaceId", "accountId", "matchKey", "direction");
CREATE INDEX "FinClassRule_spaceId_accountId_idx" ON "FinClassRule"("spaceId", "accountId");

-- AddForeignKey
ALTER TABLE "FinClassRule" ADD CONSTRAINT "FinClassRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

적용 후 `npx prisma migrate status` → up to date.

- [ ] **Step 3: 실패 e2e 작성** — `class-rules-account.e2e.test.ts` (패턴: `exclude-from-analysis.e2e.test.ts` 와 동일하게 `@/lib/api-helpers` mock, throwaway space `e2e0fin0-0000-4000-8000-0000000000f1`, user `...f2`, cleanup 은 space 삭제 cascade):

```ts
/** @jest-environment node */
/**
 * 자동 분류 규칙 계좌 단위 e2e — 계좌 전용 학습·시드 공통 생성·규칙 API(Task 3)·알림(Task 4).
 * dev DB throwaway space. DATABASE_URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (message: string, status: number, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ message, ...extra }), { status }),
}))

import { resolveDeckContext } from '@/lib/api-helpers'
import { learnRule, loadSpaceRules, classifyRow } from '@/lib/finance/classify'
import { PATCH as txnPatch } from '../../../../app/api/finance/transactions/[id]/route'

const SPACE_ID = 'e2e0fin0-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e0fin0-0000-4000-8000-0000000000f2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
  await prisma.spaceMember.deleteMany({ where: { userId: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })
}

d('finance class rules by account (dev DB)', () => {
  let accA: string
  let accB: string
  let catSales: string
  let catCogs: string
  let catCogs2: string

  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-fin-rules@throwaway.test' } })
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E FinRules' } })
    await prisma.spaceMember.create({ data: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' } })
    const acc = (name: string) =>
      prisma.finAccount.create({
        data: { spaceId: SPACE_ID, name, kind: 'BANK', institution: '테스트은행' },
        select: { id: true },
      })
    accA = (await acc('계좌A')).id
    accB = (await acc('계좌B')).id
    const cat = async (name: string, type: 'INCOME' | 'EXPENSE') => {
      const parent = await prisma.finCategory.create({
        data: { spaceId: SPACE_ID, name: `${name}그룹`, type },
        select: { id: true },
      })
      return (
        await prisma.finCategory.create({
          data: { spaceId: SPACE_ID, parentId: parent.id, name, type },
          select: { id: true },
        })
      ).id
    }
    catSales = await cat('매출', 'INCOME')
    catCogs = await cat('매입', 'EXPENSE')
    catCogs2 = await cat('외주', 'EXPENSE')
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: SPACE_ID } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('계좌 A·B 의 같은 적요는 서로 다른 규칙으로 학습되고 덮어쓰지 않는다', async () => {
    const input = { description: 'bz뱅크', counterparty: null }
    const a = await learnRule(SPACE_ID, input, catCogs, 'OUT', accA)
    const b = await learnRule(SPACE_ID, input, catCogs2, 'OUT', accB)
    expect(a!.ruleId).not.toBe(b!.ruleId)
    const rules = await loadSpaceRules(SPACE_ID)
    expect(classifyRow(input, rules, 'OUT', accA).categoryId).toBe(catCogs)
    expect(classifyRow(input, rules, 'OUT', accB).categoryId).toBe(catCogs2)
  })

  test('같은 계좌 재학습은 갱신 + previousCategoryId 반환', async () => {
    const input = { description: 'bz뱅크', counterparty: null }
    const again = await learnRule(SPACE_ID, input, catCogs2, 'OUT', accA)
    expect(again!.previousCategoryId).toBe(catCogs)
    const rules = await prisma.finClassRule.findMany({
      where: { spaceId: SPACE_ID, accountId: accA },
    })
    expect(rules).toHaveLength(1)
    expect(rules[0].categoryId).toBe(catCogs2)
  })

  test('거래 PATCH 학습은 그 거래 계좌 전용 규칙을 만든다', async () => {
    const txn = await prisma.finTransaction.create({
      data: {
        spaceId: SPACE_ID,
        accountId: accB,
        direction: 'IN',
        amount: 1000,
        txnDate: new Date('2026-03-01T00:00:00Z'),
        description: '스마트스토어정산',
        identityKey: 'e2e-rules-1',
        contentHash: 'h1',
      },
      select: { id: true },
    })
    const res = await txnPatch(
      jsonReq(`http://localhost/api/finance/transactions/${txn.id}`, 'PATCH', {
        categoryId: catSales,
      }),
      { params: Promise.resolve({ id: txn.id }) }
    )
    expect(res!.status).toBe(200)
    const rule = await prisma.finClassRule.findFirst({
      where: { spaceId: SPACE_ID, matchKey: '스마트스토어정산' },
    })
    expect(rule!.accountId).toBe(accB)
  })
})
```

- [ ] **Step 4: 실패 확인** — e2e 실행 → `learnRule` 시그니처(5번째 인자) 타입/동작 실패, `accountId` 미설정.

- [ ] **Step 5: `learnRule`·패치 헬퍼 구현** (`classify.ts`):

```ts
/**
 * 사용자 분류를 그 거래 계좌 전용 EXACT 규칙으로 학습한다(같은 계좌·적요·방향 다음부터 자동 분류).
 * 키 (spaceId, accountId, matchKey, direction) — 다른 계좌의 같은 적요 규칙은 건드리지 않는다.
 * 같은 키 규칙이 있으면 계정과목을 갱신(사용자 정정 우선)하고 이전 계정과목을 돌려준다(덮어쓰기 알림용).
 * memo: undefined=기존 유지, null=삭제, string=설정.
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
 * 행 메모가 있으면 유지, 없을 때만 규칙 메모를 쓰고 규칙 메모는 확정(EXACT) 자동분류에만 복사.
 */
export function stagedClassificationPatch(cls: ClassifyResult, currentMemo: string | null) {
  return {
    categoryId: cls.categoryId,
    classStatus: cls.classStatus,
    matchedRuleId: cls.matchedRuleId,
    memo: currentMemo ?? (cls.classStatus === 'CLASSIFIED' ? (cls.ruleMemo ?? null) : null),
  }
}
```

- [ ] **Step 6: 호출처 갱신**
  - `imports/commit-staging/route.ts`: `classifyRow(..., r.direction, accountId)`, 행 객체의 `categoryId/classStatus/matchedRuleId/memo` 4줄을 `...stagedClassificationPatch(cls, r.memo ?? null)` 로 교체(주석 유지 요지).
  - `rule-suggest.ts`: `ruleSuggestionFor(input, direction, ruleset, nameById, accountId: string | null)` → `classifyRow(input, ruleset, direction, accountId)`. 시드 합성 규칙 `accountId: null`.
  - `staging/route.ts`: `ruleSuggestionFor(..., nameById, r.accountId)`.
  - `staging/[id]/route.ts`: 행 select 에 `accountId: true`. `learnRule(..., row.direction, row.accountId, memo)` → `data.matchedRuleId = learned?.ruleId ?? null`.
  - `transactions/[id]/route.ts`: txn select 에 `accountId: true`. `const learned = await learnRule(..., txn.direction, txn.accountId)` → `data.matchedRuleId = learned?.ruleId ?? null`.
  - `agent/actions/finance.ts` classify: txn select 에 `accountId`, `learnRule(..., txn.direction, txn.accountId)` → `matchedRuleId = learned?.ruleId ?? null`. 규칙 추가 액션: 파라미터 스키마에 `accountId: z.string().optional()`(설명: 생략=전체 공통), `findFirst` where 에 `accountId: params.accountId ?? null`, create 에 `accountId`. accountId 지정 시 `prisma.finAccount.findFirst({ where: { id, spaceId } })` 소유 검증.
  - `kifrs-seed.ts` `upsertSeedRule`: `findFirst` where 에 `accountId: null`.
  - `rules/route.ts` POST: `findFirst` where 에 `accountId: null` (Task 3 에서 accountId 파라미터로 확장).

- [ ] **Step 7: 옛 키 잔존 검사** — `grep -rn "finClassRule.findFirst\|spaceId_matchKey_direction" src app --include='*.ts' | grep -v generated` → 모든 `findFirst` 에 `accountId` 조건, `spaceId_matchKey_direction` 0건.

- [ ] **Step 8: 통과 확인** — e2e 3/3 PASS, `npx jest src/lib/finance src/lib/agent` PASS, `npx tsc --noEmit -p .` 0.

- [ ] **Step 9: 커밋** — 위 파일 전부 + `src/generated/prisma`. 메시지 `✨ feat(finance): 분류 규칙 계좌 범위 스키마·백필 + 계좌 전용 학습`.

---

### Task 3: 규칙 API — 목록(계좌·사용 현황), 추가(409), 수정, 미리보기, 삭제 재분류

**Files:**

- Create: `src/lib/finance/rule-usage.ts`, `src/lib/finance/__tests__/rule-usage.test.ts`
- Modify: `src/lib/finance/classify.ts` (신규 `loadMatchTexts`, `reclassifyDraftStagedRows`)
- Modify: `app/api/finance/rules/route.ts`, `app/api/finance/rules/[id]/route.ts`
- Create: `app/api/finance/rules/preview/route.ts`
- Test: `class-rules-account.e2e.test.ts` (describe 추가)

**Interfaces:**

- Produces: `type MatchText = { accountId: string; direction: FinTxnDirection; text: string; txnDate: Date; categoryId: string | null; id: string }`
- Produces: `computeRuleUsage(rules: RuleCond[], texts: MatchText[]) → Map<string, { count: number; lastMatchedAt: Date | null }>` where `RuleCond = { id; accountId: string|null; matchKey; matchType; direction }`
- Produces: `matchingTexts(cond: Omit<RuleCond,'id'>, texts: MatchText[]) → MatchText[]`
- Produces: `loadMatchTexts(spaceId, accountId?: string | null) → Promise<MatchText[]>` (accountId 지정 시 그 계좌만)
- Produces: `reclassifyDraftStagedRows(spaceId, ruleId) → Promise<number>`
- Produces: `GET /api/finance/rules` 행 `{ ...rule, account: {id,name,kind}|null, usage: {count,lastMatchedAt} }`
- Produces: `POST /api/finance/rules` body `{ matchKey, matchType, categoryId, accountId?, memo? }` → 201 `{ rule }` | 409 `{ message, existing: { id, categoryLabel } }`
- Produces: `PATCH /api/finance/rules/[id]` body `{ matchKey?, matchType?, categoryId?, accountId?: string|null, memo?: string|null, applyToExisting?: boolean }` → `{ rule, updatedTransactions, reclassifiedStaged }` | 409
- Produces: `POST /api/finance/rules/preview` body `{ matchKey, matchType, accountId: string|null, categoryId }` → `{ count, sameCategoryCount, samples: {id, txnDate, description, counterparty, accountName}[] }`
- Produces: `DELETE /api/finance/rules/[id]` → `{ ok, reclassifiedStaged }`

- [ ] **Step 1: `rule-usage.ts` 실패 단위 테스트** (`rule-usage.test.ts`):

```ts
/** @jest-environment node */
import { computeRuleUsage, matchingTexts, type MatchText } from '../rule-usage'

const t = (
  id: string,
  accountId: string,
  text: string,
  date: string,
  categoryId: string | null = null
): MatchText => ({
  id,
  accountId,
  direction: 'OUT',
  text,
  txnDate: new Date(date),
  categoryId,
})

describe('rule usage (텍스트 매칭 기준)', () => {
  const texts = [
    t('1', 'A', '쿠팡 결제', '2026-01-01', 'cat-x'),
    t('2', 'A', '쿠팡 결제', '2026-02-01', 'cat-y'),
    t('3', 'B', '쿠팡 결제', '2026-03-01', 'cat-x'),
    t('4', 'A', '네이버', '2026-04-01'),
  ]

  test('KEYWORD 규칙은 matchedRuleId 와 무관하게 포함 매칭으로 집계', () => {
    const usage = computeRuleUsage(
      [{ id: 'kw', accountId: null, matchKey: '쿠팡', matchType: 'KEYWORD', direction: 'OUT' }],
      texts
    )
    expect(usage.get('kw')).toEqual({ count: 3, lastMatchedAt: new Date('2026-03-01') })
  })

  test('계좌 전용 규칙은 그 계좌 거래만', () => {
    const usage = computeRuleUsage(
      [{ id: 'ex', accountId: 'A', matchKey: '쿠팡 결제', matchType: 'EXACT', direction: 'OUT' }],
      texts
    )
    expect(usage.get('ex')!.count).toBe(2)
  })

  test('매칭 없음 → count 0, lastMatchedAt null', () => {
    const usage = computeRuleUsage(
      [{ id: 'none', accountId: null, matchKey: '없음', matchType: 'EXACT', direction: null }],
      texts
    )
    expect(usage.get('none')).toEqual({ count: 0, lastMatchedAt: null })
  })

  test('matchingTexts 는 조건 범위의 거래 목록', () => {
    const rows = matchingTexts(
      { accountId: 'A', matchKey: '쿠팡', matchType: 'KEYWORD', direction: 'OUT' },
      texts
    )
    expect(rows.map((r) => r.id)).toEqual(['1', '2'])
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx jest src/lib/finance/__tests__/rule-usage.test.ts` → 모듈 없음.

- [ ] **Step 3: `rule-usage.ts` 구현** (순수, prisma import 금지):

```ts
/**
 * 재무 관리 Deck — 분류 규칙 사용 현황(텍스트 매칭 기준). 순수 함수.
 * matchedRuleId 는 쓰지 않는다: 확인 분류 학습이 새 규칙 id 로 바꾸고(staging/[id]) 일괄 분류가 지워서
 * (staging/bulk) 부분포함 규칙은 실제로 쓰여도 0건으로 잡힌다.
 */
import { ruleMatchesText } from '@/lib/finance/classify-core'
import type { FinClassRuleMatchType, FinTxnDirection } from '@/generated/prisma/enums'

export type MatchText = {
  id: string
  accountId: string
  direction: FinTxnDirection
  /** 정규화 적요+상대(matchKeyOf) */
  text: string
  txnDate: Date
  categoryId: string | null
}

export type RuleCond = {
  id: string
  accountId: string | null
  matchKey: string
  matchType: FinClassRuleMatchType
  direction: FinTxnDirection | null
}

/** 조건 범위(계좌 지정 시 그 계좌) 안에서 조건에 걸리는 거래. */
export function matchingTexts(cond: Omit<RuleCond, 'id'>, texts: MatchText[]): MatchText[] {
  return texts.filter(
    (t) =>
      (!cond.accountId || t.accountId === cond.accountId) &&
      ruleMatchesText(cond, t.text, t.direction)
  )
}

export function computeRuleUsage(
  rules: RuleCond[],
  texts: MatchText[]
): Map<string, { count: number; lastMatchedAt: Date | null }> {
  const out = new Map<string, { count: number; lastMatchedAt: Date | null }>()
  for (const r of rules) {
    let count = 0
    let last: Date | null = null
    for (const t of matchingTexts(r, texts)) {
      count++
      if (!last || t.txnDate > last) last = t.txnDate
    }
    out.set(r.id, { count, lastMatchedAt: last })
  }
  return out
}
```

(`ruleMatchesText` 는 Task 1 에서 `classify-core.ts` 에 만들어 둠.)

성능 메모: 규칙 R × 거래 T 선형 스캔. 운영 R=674, T 수천~수만 → 수백만 비교로 수십 ms. `// ponytail: R×T 스캔, 규칙·거래가 10배 늘면 EXACT 를 text→목록 맵으로` 주석.

- [ ] **Step 4: 단위 통과** — 같은 명령 PASS.

- [ ] **Step 5: `classify.ts` DB 헬퍼**

```ts
/** 확정 거래의 매칭 텍스트(사용 현황·미리보기·일괄 변경 대상 계산용). */
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
```

(`MatchText` 는 `rule-usage.ts` 에서 type import)

- [ ] **Step 6: 실패 e2e 추가** (`class-rules-account.e2e.test.ts` 맨 끝 `})` 앞, import 에 `GET as rulesGet, POST as rulesPost` from `rules/route`, `PATCH as rulePatch, DELETE as ruleDelete` from `rules/[id]/route`, `POST as rulePreview` from `rules/preview/route`):

```ts
describe('규칙 API', () => {
  let ruleId: string
  const mk = (
    id: string,
    accountId: string,
    description: string,
    categoryId: string | null,
    date = '2026-04-01'
  ) =>
    prisma.finTransaction.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        direction: 'OUT',
        amount: 100,
        txnDate: new Date(`${date}T00:00:00Z`),
        description,
        categoryId,
        classStatus: categoryId ? 'CLASSIFIED' : 'UNCLASSIFIED',
        identityKey: id,
        contentHash: id,
      },
      select: { id: true },
    })

  beforeAll(async () => {
    await mk('u1', accA, '택배 CJ', catCogs)
    await mk('u2', accA, '택배 한진', catCogs)
    await mk('u3', accA, '택배 우체국', catCogs2) // 이후 사용자가 다른 계정으로 바꾼 거래
    await mk('u4', accB, '택배 CJ', catCogs)
  })

  test('POST: 계좌 A 부분포함 규칙 생성, 같은 조건 재생성은 409', async () => {
    const body = { matchKey: '택배', matchType: 'KEYWORD', categoryId: catCogs, accountId: accA }
    const res = await rulesPost(jsonReq('http://localhost/api/finance/rules', 'POST', body))
    expect(res!.status).toBe(201)
    ruleId = (await res!.json()).rule.id
    const dup = await rulesPost(jsonReq('http://localhost/api/finance/rules', 'POST', body))
    expect(dup!.status).toBe(409)
    expect((await dup!.json()).existing.id).toBe(ruleId)
  })

  test('GET: 계좌·사용 현황(텍스트 매칭, 계좌 A 만 3건)', async () => {
    const json = await (await rulesGet())!.json()
    const r = json.rules.find((x: { id: string }) => x.id === ruleId)
    expect(r.account.id).toBe(accA)
    expect(r.usage.count).toBe(3)
  })

  test('preview: 건수·같은 계정과목 건수', async () => {
    const json = await (await rulePreview(
      jsonReq('http://localhost/api/finance/rules/preview', 'POST', {
        matchKey: '택배',
        matchType: 'KEYWORD',
        accountId: accA,
        categoryId: catCogs,
      })
    ))!.json()
    expect(json.count).toBe(3)
    expect(json.sameCategoryCount).toBe(2)
    expect(json.samples.length).toBeLessThanOrEqual(5)
  })

  test('PATCH applyToExisting: 같은 계정과목 거래만 변경, 수동 변경 거래 유지', async () => {
    const res = await rulePatch(
      jsonReq(`http://localhost/api/finance/rules/${ruleId}`, 'PATCH', {
        categoryId: catCogs2,
        applyToExisting: true,
      }),
      { params: Promise.resolve({ id: ruleId }) }
    )
    expect(res!.status).toBe(200)
    expect((await res!.json()).updatedTransactions).toBe(2)
    const b = await prisma.finTransaction.findFirst({
      where: { spaceId: SPACE_ID, identityKey: 'u4' },
    })
    expect(b!.categoryId).toBe(catCogs) // 계좌 B 는 범위 밖
  })

  test('PATCH 충돌 409 — 같은 계좌·키·방향 규칙이 이미 있으면', async () => {
    const other = await rulesPost(
      jsonReq('http://localhost/api/finance/rules', 'POST', {
        matchKey: '택배 cj',
        matchType: 'KEYWORD',
        categoryId: catCogs,
        accountId: accA,
      })
    )
    const otherId = (await other!.json()).rule.id
    const res = await rulePatch(
      jsonReq(`http://localhost/api/finance/rules/${otherId}`, 'PATCH', { matchKey: '택배' }),
      { params: Promise.resolve({ id: otherId }) }
    )
    expect(res!.status).toBe(409)
  })

  test('DELETE: 대기 행을 남은 규칙으로 재분류', async () => {
    // 공통 규칙 + 계좌 규칙이 둘 다 걸리는 대기 행 → 계좌 규칙 삭제 후 공통 규칙으로
    const common = await rulesPost(
      jsonReq('http://localhost/api/finance/rules', 'POST', {
        matchKey: '택배',
        matchType: 'KEYWORD',
        categoryId: catCogs,
        accountId: null,
      })
    )
    const commonId = (await common!.json()).rule.id
    const imp = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId: accA,
        fileName: 'r.csv',
        institution: '테스트은행',
        kind: 'BANK',
        status: 'DRAFT',
      },
      select: { id: true },
    })
    const staged = await prisma.finStagedRow.create({
      data: {
        importId: imp.id,
        spaceId: SPACE_ID,
        accountId: accA,
        raw: {},
        txnDate: new Date('2026-05-01T00:00:00Z'),
        direction: 'OUT',
        amount: 10,
        description: '택배 로젠',
        categoryId: catCogs2,
        classStatus: 'REVIEW',
        matchedRuleId: ruleId,
        identityKey: 's1',
        contentHash: 's1',
      },
      select: { id: true },
    })
    const res = await ruleDelete(
      jsonReq(`http://localhost/api/finance/rules/${ruleId}`, 'DELETE'),
      { params: Promise.resolve({ id: ruleId }) }
    )
    expect((await res!.json()).reclassifiedStaged).toBeGreaterThanOrEqual(1)
    const row = await prisma.finStagedRow.findUnique({ where: { id: staged.id } })
    expect(row!.matchedRuleId).toBe(commonId)
    expect(row!.categoryId).toBe(catCogs)
  })
})
```

- [ ] **Step 7: 실패 확인** — e2e → 새 describe FAIL(preview 라우트 없음, 409 없음 등).

- [ ] **Step 8: 라우트 구현**

공용 라벨 헬퍼(`rules/route.ts` 상단에 export 하지 말고 각 라우트에서 같은 include 사용):
`category: { select: { id: true, name: true, type: true, parent: { select: { name: true } } } }`, 라벨 = `parent ? \`${parent.name} › ${name}\` : name`.

`rules/route.ts`:

- GET: `include` 에 `account: { select: { id: true, name: true, kind: true } }`. `const texts = await loadMatchTexts(spaceId)`, `const usage = computeRuleUsage(rules, texts)` → 각 행 `usage: usage.get(r.id)`.
- POST: body 에 `accountId?: string | null`, `memo?`. accountId 문자열이면 `finAccount.findFirst({ id, spaceId })` 검증(없으면 400 「계좌를 찾을 수 없습니다」). 메모는 `normalizeMemoInput`. `existing = findFirst({ spaceId, accountId: accountId ?? null, matchKey, direction })` → 있으면 `errorResponse('같은 조건의 규칙이 이미 있습니다', 409, { existing: { id, categoryLabel } })`. 없으면 create(201). (조용한 덮어쓰기 제거 — 주석으로 명시)

`rules/[id]/route.ts`:

- PATCH (신규):
  1. `rule = findFirst({ id, spaceId }, include category)` 없으면 404.
  2. next 값: `matchKey = body.matchKey !== undefined ? normalizeFinKey(body.matchKey) : rule.matchKey`(빈 문자열 400), `matchType`(EXACT|KEYWORD 검증), `categoryId`(소유 검증, type 로드), `accountId`(`undefined`=유지, `null`=공통, string=소유 검증), `memo`(`normalizeMemoInput`).
  3. `direction = directionForType(category.type)`.
  4. 충돌: `findFirst({ spaceId, accountId, matchKey, direction, id: { not: id } })` → 409 같은 형식.
  5. `$transaction`: 규칙 update. `applyToExisting === true && categoryId !== rule.categoryId` 이면 **수정 전 조건**으로 `matchingTexts({ accountId: rule.accountId, matchKey: rule.matchKey, matchType: rule.matchType, direction: rule.direction }, await loadMatchTexts(spaceId, rule.accountId))` 중 `categoryId === rule.categoryId` 인 id 들을 `finTransaction.updateMany({ where: { id: { in }, spaceId }, data: { categoryId, isTransfer: newType === 'TRANSFER', classStatus: 'CLASSIFIED' } })`.
  6. 트랜잭션 후 `reclassifiedStaged = await reclassifyDraftStagedRows(spaceId, id)`.
  7. 응답 `{ rule, updatedTransactions, reclassifiedStaged }`.
- DELETE: 기존 `updateMany` 리셋 블록을 `const reclassifiedStaged = await reclassifyDraftStagedRows(spaceId, id)` 로 교체(삭제 후 호출 — 삭제된 규칙은 loadSpaceRules 에 없음). 응답 `{ ok: true, reclassifiedStaged }`.

`rules/preview/route.ts` (신규, POST): body 검증(matchKey 정규화·빈값 400, matchType, categoryId 소유+type, accountId null|소유). `direction = directionForType(type)`. `texts = await loadMatchTexts(spaceId, accountId)`, `hits = matchingTexts({ accountId, matchKey, matchType, direction }, texts)`. 최근순 5건 id 로 `finTransaction.findMany({ where: { id: { in } }, select: { id, txnDate, description, counterparty, account: { select: { name } } } })`. 응답 `{ count: hits.length, sameCategoryCount: hits.filter((h) => h.categoryId === categoryId).length, samples }`.

- [ ] **Step 9: 통과 확인** — e2e 전체 PASS, `npx jest src/lib/finance` PASS, tsc 0.

- [ ] **Step 10: 커밋** — `rule-usage.ts`, `classify.ts`, 테스트 2개, 라우트 3개. `✨ feat(finance): 분류 규칙 수정·검색용 API(사용 현황·미리보기·충돌 409)`.

---

### Task 4: 덮어쓰기·우선 적용 알림 (lookup + 응답 notice + 대화상자 경고)

**Files:**

- Modify: `src/lib/finance/classify.ts` (신규 `ruleNoticeFor`)
- Create: `app/api/finance/rules/lookup/route.ts`
- Modify: `app/api/finance/transactions/[id]/route.ts`, `app/api/finance/staging/[id]/route.ts`
- Modify: `src/components/finance/transactions-view.tsx` (`ClassifyConfirmDialog`, `handleTxnClassify`), `src/components/finance/cashflow-view.tsx` (`TxnEditPopover`)
- Test: e2e describe 추가

**Interfaces:**

- Produces: `ruleNoticeFor(spaceId, input, direction, accountId, categoryId) → Promise<{ kind: 'REPLACED' | 'OVERRIDES'; fromCategoryId: string; fromLabel: string } | null>`
- Produces: `GET /api/finance/rules/lookup?accountId&direction&description&counterparty&categoryId` → `{ notice }`
- Produces: `PATCH transactions/[id]`·`staging/[id]` 응답에 `ruleNotice` (학습했을 때만)

- [ ] **Step 1: 실패 e2e** (import `GET as rulesLookup` from `rules/lookup/route`):

```ts
describe('덮어쓰기·우선 적용 알림', () => {
  const q = (p: Record<string, string>) =>
    new NextRequest(`http://localhost/api/finance/rules/lookup?${new URLSearchParams(p)}`)

  test('공통 규칙 적용 중 → OVERRIDES, 같은 키 계좌 규칙 → REPLACED, 같은 계정과목 → null', async () => {
    await prisma.finClassRule.create({
      data: {
        spaceId: SPACE_ID,
        accountId: null,
        matchKey: '알림테스트',
        matchType: 'EXACT',
        direction: 'OUT',
        categoryId: catCogs,
        learnedFrom: 'USER',
      },
    })
    const base = { accountId: accA, direction: 'OUT', description: '알림테스트', counterparty: '' }
    let json = await (await rulesLookup(q({ ...base, categoryId: catCogs2 })))!.json()
    expect(json.notice.kind).toBe('OVERRIDES')
    json = await (await rulesLookup(q({ ...base, categoryId: catCogs })))!.json()
    expect(json.notice).toBeNull()
    await learnRule(SPACE_ID, { description: '알림테스트' }, catCogs, 'OUT', accA)
    json = await (await rulesLookup(q({ ...base, categoryId: catCogs2 })))!.json()
    expect(json.notice.kind).toBe('REPLACED')
  })
})
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현**

`classify.ts`:

```ts
/**
 * 학습 직전 알림 — 지금 이 거래에 실제 적용되는 규칙(classifyRow) 기준.
 *  - REPLACED: 이 계좌의 같은 키 규칙(계정과목 다름)을 덮어씀
 *  - OVERRIDES: 공통 규칙(또는 이 계좌 부분포함 규칙)이 적용 중인데 새 계좌 규칙이 대신 적용됨
 * 적용 규칙이 없거나 같은 계정과목이면 null.
 */
export async function ruleNoticeFor(
  spaceId: string,
  input: ClassifyInput,
  direction: FinTxnDirection,
  accountId: string,
  categoryId: string
): Promise<{ kind: 'REPLACED' | 'OVERRIDES'; fromCategoryId: string; fromLabel: string } | null> {
  const rules = await loadSpaceRules(spaceId)
  const cls = classifyRow(input, rules, direction, accountId)
  if (!cls.matchedRuleId || !cls.categoryId || cls.categoryId === categoryId) return null
  const rule = rules.find((r) => r.id === cls.matchedRuleId)!
  const sameKey =
    rule.accountId === accountId &&
    rule.matchType === 'EXACT' &&
    rule.direction === direction &&
    rule.matchKey === buildMatchText(input)
  const cat = await prisma.finCategory.findUnique({
    where: { id: cls.categoryId },
    select: { name: true, parent: { select: { name: true } } },
  })
  const fromLabel = cat ? (cat.parent ? `${cat.parent.name} › ${cat.name}` : cat.name) : ''
  return { kind: sameKey ? 'REPLACED' : 'OVERRIDES', fromCategoryId: cls.categoryId, fromLabel }
}
```

`rules/lookup/route.ts` (GET): 파라미터 검증(accountId 소유, direction IN|OUT, categoryId 필수) → `{ notice: await ruleNoticeFor(...) }`.

`transactions/[id]` · `staging/[id]`: `learn` 경로에서 `learnRule` **호출 전** `ruleNotice = await ruleNoticeFor(spaceId, input, direction, accountId, categoryId)`, 응답에 `ruleNotice` 포함(학습 안 하면 null).

UI:

- `transactions-view.tsx` `handleTxnClassify`: 응답 `json.ruleNotice` 있으면 `toast.info(kind === 'REPLACED' ? \`이 계좌의 규칙도 ${fromLabel}에서 변경했습니다\` : \`이 계좌에 새 규칙이 생겨 기존 규칙(${fromLabel}) 대신 적용됩니다\`)`.
- `ClassifyConfirmDialog`: props 에 `lookup: { accountId; direction; description; counterparty; categoryId }` 추가(호출부는 대기 행 정보로 채움). `learn` 가 true 가 되면 `/api/finance/rules/lookup` 조회해 notice 를 체크박스 아래 amber 텍스트로:
  - REPLACED: `이 계좌의 규칙 〈{fromLabel}〉 → 〈{categoryLabel}〉로 변경됩니다`
  - OVERRIDES: `이 계좌에 새 규칙 〈{categoryLabel}〉가 생겨 기존 규칙 〈{fromLabel}〉 대신 적용됩니다`
- `cashflow-view.tsx` `TxnEditPopover`: `PanelTxn` 에 `accountId`(API 응답에 이미 있음 — 타입만 추가), `dirtyCategory && learn` 일 때 같은 lookup·문구.

- [ ] **Step 4: 통과 확인** — e2e PASS, eslint(변경 파일) 0, tsc 0.

- [ ] **Step 5: 커밋** — `✨ feat(finance): 규칙 학습 시 덮어쓰기·우선 적용 알림`.

---

### Task 5: 규칙 관리 UI — 좌측 계좌 목록 + 표 + 검색·필터 + 추가/수정 팝업

**Files:**

- Create: `src/components/finance/class-rules-manager.tsx`
- Modify: `src/components/finance/accounts-manager.tsx` (`RuleManager`·`Rule` 타입 제거, `rules` 상태는 탭 카운트용으로 유지하되 `ClassRulesManager` 가 자체 조회)

**Interfaces:**

- Consumes: Task 3 API 전부.
- Produces: `export function ClassRulesManager({ leafTargets, onCountChange }: { leafTargets: ComboOption[]; onCountChange?: (n: number) => void })`

UI 라 자동 테스트 대신 Step 4 수동 검증.

- [ ] **Step 1: 컴포넌트 작성** — 구조:

```tsx
'use client'

/**
 * 재무 — 자동 분류 규칙 관리. 좌측 계좌 목록(전체/전체 공통/계좌별 규칙 수) + 우측 표.
 * 검색(키워드·계정과목·메모)·필터(일치 방식·방향·미사용)는 클라이언트(규칙 수백 개 수준).
 * 행 클릭 → 수정 팝업(RuleDialog), 「규칙 추가」 → 같은 팝업 생성 모드(좌측 선택 계좌 기본값).
 */
```

상태: `rules`, `accounts`(`/api/finance/accounts`), `scope: 'ALL' | 'COMMON' | accountId`, `q`, `matchFilter: 'ALL'|'EXACT'|'KEYWORD'`, `dirFilter: 'ALL'|'IN'|'OUT'`, `unusedOnly`, `editing: Rule | 'new' | null`.

- 조회 `load()` → `GET /api/finance/rules` → `setRules`, `onCountChange?.(rules.length)`.
- 좌측: `<nav className="w-56 shrink-0 space-y-0.5">` 버튼 목록 — 「전체 (n)」, 「전체 공통 (n)」, 계좌별 `accountKindLabel(kind) 이름 (n)`(n=그 계좌 규칙 수, 0개 계좌도 표시). 선택 항목 `bg-muted font-medium`.
- 우측 상단: `Input` 검색(placeholder 「키워드·계정과목·메모 검색」), `Select` 일치 방식(전체/완전 일치/부분 포함), `Select` 방향(전체/수입/지출), `Checkbox` 「미사용만」, 「규칙 추가」 버튼.
- 필터 함수:
  ```ts
  const visible = rules.filter(
    (r) =>
      (scope === 'ALL' || (scope === 'COMMON' ? r.accountId === null : r.accountId === scope)) &&
      (matchFilter === 'ALL' || r.matchType === matchFilter) &&
      (dirFilter === 'ALL' || r.direction === dirFilter) &&
      (!unusedOnly || r.usage.count === 0) &&
      (!needle ||
        [r.matchKey, categoryLabel(r.category), r.memo ?? ''].some((s) =>
          s.toLowerCase().includes(needle)
        ))
  )
  ```
  (`needle = normalize(q)` — 소문자·공백 정리)
- 표(`Table`): 키워드(`font-mono`) · 일치(배지 완전/부분) · 방향(수입/지출/—) · 계정과목 · 계좌(scope='ALL' 일 때만, 공통은 「전체 공통」) · 메모(truncate) · 매칭(`usage.count`, 0 이면 muted 「미사용」) · 최근 매칭(`ymdOf`) · 삭제 버튼(`stopPropagation`, 기존 confirm 문구 + 응답 `reclassifiedStaged` 있으면 토스트 「대기 중 N건을 다시 분류했습니다」). 행 `onClick` → `setEditing(rule)`, `cursor-pointer`.
- 표 위 결과 수 「N개 규칙」. 빈 결과 「조건에 맞는 규칙이 없습니다」.

`RuleDialog`(같은 파일):

- props `{ mode: 'new' | Rule, accounts, leafTargets, defaultAccountId: string | null, onClose, onSaved }`.
- 필드: 키워드 `Input`, 일치 방식 `Select`(완전 일치 / 부분 포함), 계정과목 `CategoryCombobox`(leafTargets), 적용 계좌 `Select`(「전체 공통」 value `__common__` + 계좌), 메모 `Textarea`(MEMO_MAX).
- 미리보기: 키워드·일치·계좌·계정과목 변경 400ms 디바운스 후 `POST /api/finance/rules/preview` → 「이 조건에 걸리는 확정 거래 N건」 + 최근 5건(날짜·계좌·적요) 리스트, 하단 회색 안내 「다른 규칙과의 우선순위는 반영하지 않은 범위입니다」.
- 수정 모드 + 계정과목 변경 시: 원래 조건으로 preview 1회(열 때) 받아둔 `sameCategoryCount` 로 `Checkbox` 「이 규칙으로 분류된 기존 거래 {sameCategoryCount}건도 함께 변경」(0건이면 숨김, 기본 해제).
- 저장: 생성 `POST /api/finance/rules`, 수정 `PATCH /api/finance/rules/{id}`(변경 필드만 + `applyToExisting`). 409 → 폼 하단 destructive 텍스트 「같은 조건의 규칙이 이미 있습니다: 〈{existing.categoryLabel}〉 — 그 규칙을 수정하세요」(팝업 유지). 성공 토스트: 수정 시 `updatedTransactions`·`reclassifiedStaged` 건수 포함.

- [ ] **Step 2: `accounts-manager.tsx` 교체** — `RuleManager` 함수·`Rule` 타입·관련 import(사용처 없어진 것만) 삭제. 탭 카운트: `const [ruleCount, setRuleCount] = useState<number | null>(null)`, 초기 `load` 의 rules fetch 결과로 설정 유지, `<TabsContent value="rules"><ClassRulesManager leafTargets={leafTargets} onCountChange={setRuleCount} /></TabsContent>`.

- [ ] **Step 3: 정적 검사** — `npx eslint --max-warnings=0 src/components/finance/class-rules-manager.tsx src/components/finance/accounts-manager.tsx` 0, tsc 0.

- [ ] **Step 4: 수동 검증**(로컬 dev, `hello@ameaning.co.kr` 계정, 포트 3021, Playwright 는 새 탭에서):
  1. 좌측 계좌별 규칙 수 합 = 전체 수.
  2. 검색 「bz」 → 키워드·계정과목·메모 포함 행만.
  3. 「미사용만」 → usage 0 행만.
  4. 행 클릭 → 수정 팝업, 계정과목 바꾸면 미리보기·「기존 거래 N건」 표시 → 저장 → 표 갱신.
  5. 다른 규칙과 같은 키워드로 수정 → 409 문구, 팝업 유지.
  6. 추가 팝업 계좌 기본값 = 좌측 선택.
  7. 바꾼 데이터 원복.

- [ ] **Step 5: 커밋** — `✨ feat(finance): 자동 분류 규칙 관리 화면(계좌 목록·검색·수정·사용 현황)`.

---

### Task 6: 전체 검증

- [ ] `npm run lint` 0 error, `npx jest src/lib/finance src/lib/agent` PASS, e2e(`class-rules-account`, `exclude-from-analysis`, `finance-commit-snapshot`, `finance-classify-refund`) PASS, `npm run build` 성공.
- [ ] 백필 결과 dev 확인: `SELECT count(*) FILTER (WHERE "accountId" IS NOT NULL), count(*) FROM "FinClassRule"` (dev DB, 마이그레이션 적용 후).
- [ ] `git diff origin/develop | grep -nE "^\+.*(TODO|test\.skip|\.only\()"` 출력 없음.
