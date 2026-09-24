# 초기 마케팅비 생산원가 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 생산 차수의 초기 마케팅비를 특정 상품의 실제 입고수량에 배분하고, 상품 옵션과 가격 시뮬레이션에서 생산원가와 분리해 보여준다.

**Architecture:** 기존 `ProductionRunCost`에 `MARKETING` 분류와 대상 상품 FK를 추가한다. 쓰기 검증과 읽기 배분 계산을 각각 순수 모듈로 분리하고, 가격 계산 엔진에는 구성별 COGS를 전달하되 기존 총 `cogs` 계약은 유지한다.

**Tech Stack:** Next.js 16 App Router, TypeScript strict mode, React, Prisma/PostgreSQL, Zod, Jest, Testing Library, Tailwind CSS

**Design reference:** `docs/decks/seller-hub/prd/2026-09-24-production-marketing-cost-design.md`

---

## 변경 파일 지도

| 책임                    | 파일                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB enum, FK, relation   | `prisma/schema.prisma`, Prisma가 생성한 `prisma/migrations/*_add_production_marketing_cost/migration.sql`                                                                                                             |
| 생산 원가 입력 계약     | `src/lib/sh/schemas.ts`, `src/lib/sh/production-run-costs.ts`                                                                                                                                                         |
| 상품별 배분 계산        | `src/lib/sh/production-cost-allocation.ts`                                                                                                                                                                            |
| 생산 차수 저장·복원     | `app/api/sh/production-runs/route.ts`, `app/api/sh/production-runs/[runId]/route.ts`                                                                                                                                  |
| 상품별 원가 조회        | `app/api/sh/products/[productId]/options/route.ts`                                                                                                                                                                    |
| 생산 차수 원가 UI       | `src/components/sh/products/production/production-run-form-dialog.tsx`                                                                                                                                                |
| 옵션 원가 표시          | `src/components/sh/products/product-options-table.tsx`                                                                                                                                                                |
| 가격 그룹과 시나리오 행 | `src/lib/sh/price-group.ts`, `src/lib/sh/resolve-product-price-group.ts`, `src/components/sh/products/pricing-sim/pricing-bundle-row.tsx`, `src/components/sh/products/pricing-sim/pricing-product-picker-dialog.tsx` |
| 가격 엔진과 비용 막대   | `src/lib/sh/pricing-matrix-calc.ts`, `src/components/sh/products/pricing-sim/pricing-quick-flow.tsx`, `src/components/sh/products/pricing-sim/pricing-cost-bar.tsx`                                                   |
| snapshot 계약           | `src/lib/sh/pricing-scenario-snapshot.ts`                                                                                                                                                                             |
| 테스트                  | 아래 각 Task의 `Test` 경로                                                                                                                                                                                            |

---

### Task 1: Prisma 모델과 입력 스키마 확장

**Files:**

- Modify: `prisma/schema.prisma`
- Create: Prisma가 생성한 `prisma/migrations/*_add_production_marketing_cost/migration.sql`
- Modify: `src/lib/sh/schemas.ts`
- Create: `src/lib/sh/__tests__/production-run-cost-schema.test.ts`

- [ ] **Step 1: `MARKETING` 입력 계약의 실패 테스트 작성**

```ts
import { productionRunCostSchema } from '@/lib/sh/schemas'

const base = {
  itemName: '체험단',
  quantity: 1,
  unitPrice: 3_000_000,
  vatIncluded: true,
}

describe('productionRunCostSchema', () => {
  it('마케팅 비용은 대상 상품이 필수다', () => {
    expect(productionRunCostSchema.safeParse({ ...base, category: 'MARKETING' }).success).toBe(
      false
    )
  })

  it('마케팅 비용의 대상 상품을 보존한다', () => {
    const parsed = productionRunCostSchema.parse({
      ...base,
      category: 'MARKETING',
      targetProductId: 'product-123',
    })
    expect(parsed.targetProductId).toBe('product-123')
  })

  it('일반 비용의 대상 상품은 제거한다', () => {
    const parsed = productionRunCostSchema.parse({
      ...base,
      category: 'MATERIAL',
      targetProductId: 'product-123',
    })
    expect(parsed.targetProductId).toBeUndefined()
  })
})
```

- [ ] **Step 2: 테스트가 현재 enum과 필드 부재로 실패하는지 확인**

Run: `npm test -- src/lib/sh/__tests__/production-run-cost-schema.test.ts --runInBand`

Expected: `MARKETING`이 허용되지 않거나 `targetProductId`가 보존되지 않아 FAIL.

- [ ] **Step 3: Zod 비용 스키마에 분류와 조건부 대상 필드 추가**

`src/lib/sh/schemas.ts`에서 입력을 변환한 뒤 조건을 검사한다.

```ts
const productionCostCategorySchema = z.enum([
  'MATERIAL',
  'LABOR',
  'PACKAGING',
  'LOGISTICS',
  'MARKETING',
  'OTHER',
])

export const productionRunCostSchema = z
  .object({
    itemName: z.string().trim().min(1).max(100),
    description: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v?.length ? v : undefined)),
    spec: z.coerce.number().positive().max(99_999_999).optional(),
    quantity: z.coerce.number().positive().max(99_999_999).default(1),
    unitPrice: z.coerce.number().min(0).max(99_999_999),
    note: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v?.length ? v : undefined)),
    sortOrder: z.number().int().min(0).optional(),
    category: productionCostCategorySchema.default('OTHER'),
    targetProductId: idLike.optional(),
    vatIncluded: z.coerce.boolean().default(true),
  })
  .transform((cost, ctx) => {
    if (cost.category === 'MARKETING' && !cost.targetProductId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetProductId'],
        message: '마케팅 비용의 대상 상품을 선택하세요',
      })
      return z.NEVER
    }
    return {
      ...cost,
      targetProductId: cost.category === 'MARKETING' ? cost.targetProductId : undefined,
    }
  })
```

- [ ] **Step 4: Prisma schema를 확장하고 migration 생성**

`InvProduct`에 역관계를, enum과 비용 모델에 새 필드를 추가한다.

```prisma
model InvProduct {
  // 기존 필드 유지
  targetedProductionCosts ProductionRunCost[]
}

enum ProductionCostCategory {
  MATERIAL
  LABOR
  PACKAGING
  LOGISTICS
  MARKETING
  OTHER
}

model ProductionRunCost {
  // 기존 필드 유지
  targetProductId String?
  targetProduct   InvProduct? @relation(fields: [targetProductId], references: [id], onDelete: Restrict)

  @@index([runId])
  @@index([targetProductId])
}
```

Run: `npx prisma migrate dev --name add_production_marketing_cost`

Expected: migration 생성·dev DB 적용·Prisma Client 재생성 성공. 생성 SQL에 enum value, nullable column, FK, index가 포함되어야 한다.

- [ ] **Step 5: 스키마 테스트와 Prisma 검증 실행**

Run: `npm test -- src/lib/sh/__tests__/production-run-cost-schema.test.ts --runInBand`

Expected: PASS.

Run: `npx prisma validate`

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 6: 계약 변경 커밋**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/sh/schemas.ts src/lib/sh/__tests__/production-run-cost-schema.test.ts
git commit -m "feat: 생산차수 마케팅 원가 계약 추가"
```

---

### Task 2: 생산 차수 쓰기 검증과 API 저장

**Files:**

- Create: `src/lib/sh/production-run-costs.ts`
- Create: `src/lib/sh/__tests__/production-run-costs.test.ts`
- Modify: `app/api/sh/production-runs/route.ts`
- Modify: `app/api/sh/production-runs/[runId]/route.ts`

- [ ] **Step 1: 대상 상품 소속 검증의 실패 테스트 작성**

```ts
import { validateProductionCostTargets } from '@/lib/sh/production-run-costs'

const marketing = (targetProductId: string) => ({ category: 'MARKETING' as const, targetProductId })

describe('validateProductionCostTargets', () => {
  it('차수에 포함된 상품을 허용한다', () => {
    expect(validateProductionCostTargets([marketing('p1')], new Set(['p1', 'p2']))).toBeNull()
  })

  it('차수에서 빠진 대상 상품을 거부한다', () => {
    expect(validateProductionCostTargets([marketing('p3')], new Set(['p1', 'p2']))).toBe(
      '마케팅 비용의 대상 상품이 생산 차수에 포함되어 있지 않습니다'
    )
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/lib/sh/__tests__/production-run-costs.test.ts --runInBand`

Expected: module을 찾지 못해 FAIL.

- [ ] **Step 3: 작은 검증 모듈 구현**

```ts
type TargetedCost = {
  category: string
  targetProductId?: string | null
}

export function validateProductionCostTargets(
  costs: TargetedCost[],
  productIds: ReadonlySet<string>
): string | null {
  for (const cost of costs) {
    if (cost.category !== 'MARKETING') continue
    if (!cost.targetProductId) return '마케팅 비용의 대상 상품을 선택하세요'
    if (!productIds.has(cost.targetProductId)) {
      return '마케팅 비용의 대상 상품이 생산 차수에 포함되어 있지 않습니다'
    }
  }
  return null
}
```

- [ ] **Step 4: POST에서 option의 product ID를 조회하고 비용을 검증·저장**

`app/api/sh/production-runs/route.ts`의 `validOptions` select에 `product.id`를 포함하고, `costsData` 타입과 매핑에 `MARKETING`, `targetProductId`를 추가한다.

```ts
const productIds = new Set(validOptions.map((option) => option.product.id))
const targetError = validateProductionCostTargets(input.costs ?? [], productIds)
if (targetError) return errorResponse(targetError, 400)

const costsData = (input.costs ?? []).map((cost, index) => ({
  itemName: cost.itemName,
  description: cost.description,
  spec: cost.spec,
  quantity: cost.quantity,
  unitPrice: cost.unitPrice,
  amount: (cost.spec ?? 1) * cost.quantity * cost.unitPrice,
  note: cost.note,
  sortOrder: cost.sortOrder ?? index,
  category: cost.category,
  targetProductId: cost.category === 'MARKETING' ? cost.targetProductId : null,
  vatIncluded: cost.vatIncluded,
}))
```

- [ ] **Step 5: PATCH에서 최종 items와 최종 costs 조합을 검증**

기존 조회에 items와 costs를 포함한다. `input.items`가 없으면 기존 상품 집합을, `input.costs`가 없으면 기존 비용을 사용해 검증한다. 이 순서를 transaction 전에 수행해야 대상 상품을 제거한 수정이 저장되지 않는다.

```ts
let effectiveProductIds = new Set(existing.items.map((item) => item.option.product.id))
if (input.items) {
  const optionIds = input.items.map((item) => item.optionId)
  const validOptions = await prisma.invProductOption.findMany({
    where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
    select: { id: true, product: { select: { id: true } } },
  })
  if (validOptions.length !== optionIds.length) {
    return errorResponse('일부 옵션을 찾을 수 없습니다', 400)
  }
  effectiveProductIds = new Set(validOptions.map((option) => option.product.id))
}
const effectiveCosts = input.costs ?? existing.costs
const targetError = validateProductionCostTargets(effectiveCosts, effectiveProductIds)
if (targetError) return errorResponse(targetError, 400)
```

GET 응답의 각 cost에는 `category`와 `targetProductId`를 모두 포함한다.

- [ ] **Step 6: 검증 테스트와 관련 typecheck 실행**

Run: `npm test -- src/lib/sh/__tests__/production-run-costs.test.ts src/lib/sh/__tests__/production-run-cost-schema.test.ts --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: API 저장 변경 커밋**

```bash
git add src/lib/sh/production-run-costs.ts src/lib/sh/__tests__/production-run-costs.test.ts app/api/sh/production-runs/route.ts app/api/sh/production-runs/[runId]/route.ts
git commit -m "feat: 생산차수 마케팅 원가 대상 검증"
```

---

### Task 3: 상품별 원가 배분 계산과 옵션 API 연결

**Files:**

- Create: `src/lib/sh/production-cost-allocation.ts`
- Create: `src/lib/sh/__tests__/production-cost-allocation.test.ts`
- Modify: `app/api/sh/products/[productId]/options/route.ts`

- [ ] **Step 1: 실제 입고수량·대상 귀속·누적 평균 실패 테스트 작성**

```ts
import { calculateProductUnitCosts } from '@/lib/sh/production-cost-allocation'

describe('calculateProductUnitCosts', () => {
  it('공통 생산비는 전체 수량에, 마케팅비는 대상 상품에만 배분한다', () => {
    const result = calculateProductUnitCosts([
      {
        id: 'r1',
        items: [
          { productId: 'p1', quantity: 120, stockedInQty: 100 },
          { productId: 'p2', quantity: 50, stockedInQty: 50 },
        ],
        costs: [
          { amount: 1_650_000, vatIncluded: true, category: 'MATERIAL', targetProductId: null },
          { amount: 330_000, vatIncluded: true, category: 'MARKETING', targetProductId: 'p1' },
        ],
      },
    ])

    expect(result.get('p1')).toMatchObject({
      productionUnitCost: 10_000,
      marketingUnitCost: 3_000,
      totalUnitCost: 13_000,
      runCount: 1,
    })
    expect(result.get('p2')).toMatchObject({
      productionUnitCost: 10_000,
      marketingUnitCost: 0,
      totalUnitCost: 10_000,
    })
  })

  it('후속 생산수량으로 마케팅비를 누적 가중평균한다', () => {
    const result = calculateProductUnitCosts([
      {
        id: 'r1',
        items: [{ productId: 'p1', quantity: 1000, stockedInQty: 1000 }],
        costs: [
          { amount: 3_000_000, vatIncluded: false, category: 'MARKETING', targetProductId: 'p1' },
        ],
      },
      {
        id: 'r2',
        items: [{ productId: 'p1', quantity: 1000, stockedInQty: 1000 }],
        costs: [],
      },
    ])
    expect(result.get('p1')?.marketingUnitCost).toBe(1500)
  })

  it('입고수량 0은 발주수량으로 대체하지 않는다', () => {
    const result = calculateProductUnitCosts([
      {
        id: 'r1',
        items: [{ productId: 'p1', quantity: 100, stockedInQty: 0 }],
        costs: [
          { amount: 100_000, vatIncluded: false, category: 'MATERIAL', targetProductId: null },
        ],
      },
    ])
    expect(result.has('p1')).toBe(false)
  })

  it('비용 행이 없는 구 차수는 totalCost를 생산비로 사용한다', () => {
    const result = calculateProductUnitCosts([
      {
        id: 'legacy',
        totalCost: 500_000,
        items: [{ productId: 'p1', quantity: 100, stockedInQty: null }],
        costs: [],
      },
    ])
    expect(result.get('p1')).toMatchObject({
      productionUnitCost: 5_000,
      marketingUnitCost: 0,
      totalUnitCost: 5_000,
    })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/lib/sh/__tests__/production-cost-allocation.test.ts --runInBand`

Expected: module을 찾지 못해 FAIL.

- [ ] **Step 3: 순수 배분 함수 구현**

`costExVat`를 재사용하고 금액은 계산 마지막에만 반올림한다.

```ts
import { costExVat } from '@/lib/sh/cost'

export type ProductionCostRun = {
  id: string
  /** costs 행이 없던 구 데이터의 총원가 */
  totalCost?: number | null
  items: Array<{
    productId: string
    quantity: number
    stockedInQty: number | null
  }>
  costs: Array<{
    amount: number
    vatIncluded: boolean
    category: string
    targetProductId: string | null
  }>
}

export type ProductUnitCostBreakdown = {
  productionUnitCost: number
  marketingUnitCost: number
  totalUnitCost: number
  runCount: number
}

export function calculateProductUnitCosts(runs: ProductionCostRun[]) {
  const totals = new Map<
    string,
    { quantity: number; production: number; marketing: number; runs: Set<string> }
  >()

  for (const run of runs) {
    const quantities = new Map<string, number>()
    for (const item of run.items) {
      const quantity = Math.max(0, item.stockedInQty ?? item.quantity)
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + quantity)
    }
    const runQuantity = [...quantities.values()].reduce((sum, quantity) => sum + quantity, 0)
    if (runQuantity <= 0) continue

    const production =
      run.costs.length > 0
        ? run.costs
            .filter((cost) => cost.category !== 'MARKETING')
            .reduce((sum, cost) => sum + costExVat(cost.amount, cost.vatIncluded), 0)
        : Number(run.totalCost ?? 0)

    for (const [productId, quantity] of quantities) {
      if (quantity <= 0) continue
      const current = totals.get(productId) ?? {
        quantity: 0,
        production: 0,
        marketing: 0,
        runs: new Set<string>(),
      }
      current.quantity += quantity
      current.production += production * (quantity / runQuantity)
      current.marketing += run.costs
        .filter((cost) => cost.category === 'MARKETING' && cost.targetProductId === productId)
        .reduce((sum, cost) => sum + costExVat(cost.amount, cost.vatIncluded), 0)
      current.runs.add(run.id)
      totals.set(productId, current)
    }
  }

  return new Map(
    [...totals].map(([productId, total]) => {
      const productionUnitCost = total.production / total.quantity
      const marketingUnitCost = total.marketing / total.quantity
      return [
        productId,
        {
          productionUnitCost,
          marketingUnitCost,
          totalUnitCost: productionUnitCost + marketingUnitCost,
          runCount: total.runs.size,
        },
      ]
    })
  )
}
```

- [ ] **Step 4: 옵션 API가 완료 차수를 한 번 조회해 공통 계산기를 사용하도록 변경**

`app/api/sh/products/[productId]/options/route.ts`에서 현재 inline 가중평균 코드를 제거한다. `STOCKED_IN` 차수의 모든 items를 조회해야 다상품 차수의 전체 분모가 유지된다.

```ts
const completedRuns = await prisma.productionRun.findMany({
  where: {
    spaceId: resolved.space.id,
    status: 'STOCKED_IN',
    items: { some: { option: { productId } } },
  },
  select: {
    id: true,
    totalCost: true,
    items: {
      select: { quantity: true, stockedInQty: true, option: { select: { productId: true } } },
    },
    costs: { select: { amount: true, vatIncluded: true, category: true, targetProductId: true } },
  },
})

const productionCost =
  calculateProductUnitCosts(
    completedRuns.map((run) => ({
      id: run.id,
      totalCost: run.totalCost == null ? null : Number(run.totalCost),
      items: run.items.map((item) => ({
        productId: item.option.productId,
        quantity: item.quantity,
        stockedInQty: item.stockedInQty,
      })),
      costs: run.costs.map((cost) => ({ ...cost, amount: Number(cost.amount) })),
    }))
  ).get(productId) ?? null
```

응답의 `productionCost`는 새 breakdown 전체를 반환하고, 각 option에는 `effectiveCostPrice`, `productionUnitCost`, `marketingUnitCost`를 추가한다. 생산 원가 연동이 꺼져 있으면 수동 ex-VAT 원가를 `productionUnitCost`로 사용한다.

기존 데이터처럼 `costs` 행이 없으면 `ProductionRun.totalCost` 전체를 생산비로 사용한다. 이 fallback을 단위 테스트에 추가해 과거 생산 차수의 원가가 0원으로 바뀌지 않도록 고정한다.

- [ ] **Step 5: 배분 테스트와 typecheck 실행**

Run: `npm test -- src/lib/sh/__tests__/production-cost-allocation.test.ts src/lib/sh/__tests__/cost.test.ts --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: 배분 엔진과 옵션 API 커밋**

```bash
git add src/lib/sh/production-cost-allocation.ts src/lib/sh/__tests__/production-cost-allocation.test.ts app/api/sh/products/[productId]/options/route.ts
git commit -m "feat: 초기 마케팅비 상품 원가 배분"
```

---

### Task 4: 생산 차수 원가 입력 UI

**Files:**

- Modify: `src/components/sh/products/production/production-run-form-dialog.tsx`
- Create: `src/components/sh/products/production/__tests__/production-run-form-dialog.test.tsx`

- [ ] **Step 1: 편집 화면 복원과 잘못된 대상 차단의 실패 테스트 작성**

Testing Library에서 `global.fetch`를 mock해 편집 상세에 상품 2개와 `MARKETING` cost를 반환한다.

```tsx
const patchFetch = jest.fn()
global.fetch = jest.fn(async (input, init) => {
  const url = String(input)
  if (url.endsWith('/api/sh/production-runs/run-1') && !init?.method) {
    return new Response(
      JSON.stringify({
        run: {
          id: 'run-1',
          runNo: 'RUN-001',
          status: 'PLANNED',
          orderedConfirmedAt: null,
          stockedInAt: null,
          createdAt: '2026-09-24T00:00:00.000Z',
          totalCost: 3_000_000,
          costMode: 'TOTAL',
          memo: null,
          items: [
            {
              id: 'ri1',
              optionId: 'o1',
              optionName: 'A',
              sku: null,
              productId: 'p1',
              productName: '상품 A',
              brandName: null,
              quantity: 1000,
              stockedInQty: null,
            },
            {
              id: 'ri2',
              optionId: 'o2',
              optionName: 'B',
              sku: null,
              productId: 'p2',
              productName: '상품 B',
              brandName: null,
              quantity: 500,
              stockedInQty: null,
            },
          ],
          costs: [
            {
              id: 'c1',
              itemName: '체험단',
              description: null,
              spec: null,
              quantity: 1,
              unitPrice: 3_000_000,
              amount: 3_000_000,
              note: null,
              sortOrder: 0,
              category: 'MARKETING',
              targetProductId: 'p1',
              vatIncluded: false,
            },
          ],
        },
      }),
      { status: 200 }
    )
  }
  patchFetch(input, init)
  return new Response(JSON.stringify({ run: { id: 'run-1' } }), { status: 200 })
}) as jest.Mock

render(<ProductionRunFormDialog open onOpenChange={jest.fn()} runId="run-1" onSaved={jest.fn()} />)

expect(await screen.findByDisplayValue('체험단')).toBeInTheDocument()
expect(screen.getByText('마케팅')).toBeInTheDocument()
expect(screen.getByText('상품 A')).toBeInTheDocument()
```

두 번째 테스트에서는 `상품 A 제거` 버튼을 누른 뒤 저장이 차단되는지 검증한다.

```tsx
const user = userEvent.setup()
await user.click(await screen.findByRole('button', { name: '상품 A 전체 제거' }))
await user.click(screen.getByRole('button', { name: '수정' }))

expect(
  await screen.findByText('마케팅 비용의 대상 상품이 생산 차수에 포함되어 있지 않습니다')
).toBeInTheDocument()
expect(patchFetch).not.toHaveBeenCalled()
```

- [ ] **Step 2: UI 테스트가 category/target 필드 부재로 실패하는지 확인**

Run: `npm test -- src/components/sh/products/production/__tests__/production-run-form-dialog.test.tsx --runInBand`

Expected: `마케팅` 또는 대상 상품을 찾지 못해 FAIL.

- [ ] **Step 3: 두 원가 행 타입과 로드·저장 payload 확장**

```ts
type CostCategory = 'MATERIAL' | 'LABOR' | 'PACKAGING' | 'LOGISTICS' | 'MARKETING' | 'OTHER'

type CostTarget = {
  category: CostCategory
  targetProductId: string | null
}

type CostRow = CostTarget & {
  _key: string
  itemName: string
  description: string
  spec: string
  quantity: string
  unitPrice: string
  note: string
  vatIncluded: boolean
}

type TotalCostItem = CostTarget & {
  _key: string
  itemName: string
  amount: string
  vatIncluded: boolean
}
```

신규 행은 `category: 'OTHER'`, `targetProductId: null`로 만들고 GET 응답의 두 값을 복원한다. 저장 payload에도 두 값을 포함한다.

- [ ] **Step 4: category와 대상 상품 제어 UI 추가**

두 탭의 table에 `분류` 열을 추가하고 `MARKETING`일 때만 `대상 상품` Select를 표시한다. 상품이 하나면 `set...Rows` 갱신 시 자동으로 그 ID를 채우되 Select는 disabled로 표시한다. 여러 상품이면 placeholder `대상 상품 선택`을 표시한다.

테이블에는 architecture 규칙에 맞게 `table-fixed`와 선언한 열 폭 합계 이상의 `min-w`를 적용한다. 대상이 차수에서 사라진 행은 `aria-invalid`, destructive border, 짧은 inline error를 표시한다.

- [ ] **Step 5: 합계와 저장 전 검증 추가**

```ts
const activeRows = costMode === 'TOTAL' ? totalCostItems : costRows
const amountOf = (row: TotalCostItem | CostRow) =>
  'amount' in row ? Number(row.amount) || 0 : calcRowAmount(row)
const productionTotal = activeRows
  .filter((row) => row.category !== 'MARKETING')
  .reduce((sum, row) => sum + amountOf(row), 0)
const marketingTotal = activeRows
  .filter((row) => row.category === 'MARKETING')
  .reduce((sum, row) => sum + amountOf(row), 0)
```

하단에 생산비, 초기 마케팅비, 총 반영 원가를 tabular number로 표시한다. `handleSave`에서 마케팅 행의 대상이 `validItems`의 상품 집합에 없으면 toast 후 return한다.

`TotalCostPreview`와 입고완료 편집 화면의 단가 미리보기는 `stockedInQty ?? quantity`를 사용한다. 합산 유효 수량이 0이면 단가를 계산하지 않고 `실제 입고수량이 0개라 원가를 배분할 수 없습니다` 경고를 표시한다.

- [ ] **Step 6: UI 테스트와 typecheck 실행**

Run: `npm test -- src/components/sh/products/production/__tests__/production-run-form-dialog.test.tsx --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: 생산 차수 UI 커밋**

```bash
git add src/components/sh/products/production/production-run-form-dialog.tsx src/components/sh/products/production/__tests__/production-run-form-dialog.test.tsx
git commit -m "feat: 생산차수 초기 마케팅비 입력 UI"
```

---

### Task 5: 가격 계산 엔진의 원가 구성 분리

**Files:**

- Modify: `src/lib/sh/pricing-matrix-calc.ts`
- Modify: `src/lib/sh/__tests__/pricing-matrix-calc.test.ts`

- [ ] **Step 1: 구성별 COGS와 계산 불변성 실패 테스트 작성**

```ts
it('생산원가와 초기 마케팅비를 분리하되 총원가와 마진은 합계를 사용한다', () => {
  const result = calculateMatrix(
    makeInputs({
      salePrice: 40_000,
      packagingCost: 0,
      components: [
        {
          costPrice: 13_000,
          productionUnitCost: 10_000,
          marketingUnitCost: 3_000,
          retailPrice: 40_000,
          quantity: 2,
        },
      ],
    })
  )
  const cell = result.cells[0]
  expect(cell.productionCogs).toBe(20_000)
  expect(cell.marketingCogs).toBe(6_000)
  expect(cell.cogs).toBe(26_000)
  expect(cell.totalCost).toBeCloseTo(
    26_000 + cell.fee + cell.adCost + cell.shipping + cell.returnCost,
    2
  )
})

it('구 입력은 전체 costPrice를 생산원가로 해석한다', () => {
  const cell = calculateMatrix(makeInputs(makeBundle(15_000, 40_000))).cells[0]
  expect(cell.productionCogs).toBe(cell.cogs)
  expect(cell.marketingCogs).toBe(0)
})
```

- [ ] **Step 2: 새 필드 부재로 실패하는지 확인**

Run: `npm test -- src/lib/sh/__tests__/pricing-matrix-calc.test.ts --runInBand`

Expected: `productionCogs` 또는 `marketingCogs`가 없어 FAIL.

- [ ] **Step 3: bundle과 cell 계약 및 합산 helper 구현**

```ts
export type BundleComponent = {
  costPrice: number
  productionUnitCost?: number
  marketingUnitCost?: number
  retailPrice: number
  quantity: number
}

function bundleCostBreakdown(bundle: MatrixBundle) {
  const cogs = bundleSetCost(bundle)
  const rawMarketingCogs = bundle.components.reduce((sum, component) => {
    const quantity = Math.max(1, Math.round(n(component.quantity)))
    return sum + n(component.marketingUnitCost) * quantity
  }, 0)
  const marketingCogs = Math.min(cogs, Math.max(0, r2(rawMarketingCogs)))
  return {
    productionCogs: r2(cogs - marketingCogs),
    marketingCogs,
  }
}
```

`MatrixCell`에 `productionCogs`, `marketingCogs`를 추가한다. 공식 총원가는 계속 `costPrice` 기반 `bundleSetCost()` 결과를 사용하고, 표시 구성의 합계가 이 값을 벗어나지 않도록 생산원가를 차액으로 맞춘다. 추천가 역산도 기존 총원가를 사용해 결과를 유지한다.

- [ ] **Step 4: 전체 pricing 계산 테스트 실행**

Run: `npm test -- src/lib/sh/__tests__/pricing-matrix-calc.test.ts --runInBand`

Expected: 신규 테스트와 기존 회귀 테스트 모두 PASS.

- [ ] **Step 5: 계산 엔진 커밋**

```bash
git add src/lib/sh/pricing-matrix-calc.ts src/lib/sh/__tests__/pricing-matrix-calc.test.ts
git commit -m "feat: 가격 계산 원가 구성 분리"
```

---

### Task 6: 가격 그룹·상품 선택·snapshot에 원가 구성 전달

**Files:**

- Modify: `src/lib/sh/price-group.ts`
- Modify: `src/lib/sh/resolve-product-price-group.ts`
- Modify: `src/lib/sh/__tests__/price-group.test.ts`
- Modify: `src/lib/sh/__tests__/resolve-product-price-group.test.ts`
- Modify: `src/components/sh/products/pricing-sim/pricing-bundle-row.tsx`
- Modify: `src/components/sh/products/pricing-sim/pricing-product-picker-dialog.tsx`
- Modify: `src/components/sh/products/pricing-sim/pricing-quick-flow.tsx`
- Modify: `src/lib/sh/pricing-scenario-snapshot.ts`
- Modify: `src/lib/sh/__tests__/pricing-scenario-snapshot.test.ts`

- [ ] **Step 1: 가격 그룹과 snapshot 원가 구성 보존 실패 테스트 작성**

`price-group.test.ts`에 다음 assertion을 추가한다.

```ts
const [group] = groupOptionsByPrice([
  {
    optionId: 'o1',
    optionName: '옵션',
    costPrice: 13_000,
    productionUnitCost: 10_000,
    marketingUnitCost: 3_000,
    retailPrice: 30_000,
  },
])
expect(group.productionUnitCost).toBe(10_000)
expect(group.marketingUnitCost).toBe(3_000)
```

`pricing-scenario-snapshot.test.ts`에는 구성 필드를 가진 v2 snapshot의 JSON round-trip과 구성 필드가 없는 기존 snapshot의 parse 성공을 각각 검증한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/lib/sh/__tests__/price-group.test.ts src/lib/sh/__tests__/resolve-product-price-group.test.ts src/lib/sh/__tests__/pricing-scenario-snapshot.test.ts --runInBand`

Expected: 가격 그룹 타입에 구성 필드가 없어 FAIL.

- [ ] **Step 3: 가격 그룹과 대표 그룹에 optional 구성 필드 전달**

`OptionInput`, `PriceGroup`, `ResolvedPriceGroup`에 다음 필드를 추가하고 첫 멤버 값을 전달한다.

```ts
productionUnitCost?: number
marketingUnitCost?: number
```

그룹 key는 기존 총 `costPrice|retailPrice`를 유지한다. 같은 상품의 옵션은 동일한 생산차수 가중평균 구성을 사용하므로 별도 key 차원을 추가하지 않는다.

- [ ] **Step 4: picker와 자동 진입 경로에 API breakdown 연결**

`ApiProductOption`과 `PricingQuickFlow`의 inline 응답 타입에 두 필드를 추가한다. `groupOptionsByPrice` 입력과 `ResolvedComponent` 생성 시 숫자로 변환해 전달한다.

```ts
productionUnitCost:
  option.productionUnitCost != null ? Number(option.productionUnitCost) : undefined,
marketingUnitCost:
  option.marketingUnitCost != null ? Number(option.marketingUnitCost) : undefined,
```

`ResolvedComponent`의 필드는 optional로 두어 기존 snapshot과 신규 상품 직접 입력 행을 호환한다.

- [ ] **Step 5: MatrixBundle 생성에서 구성 필드와 합계를 함께 전달**

```ts
components: confirmedRows.map((row) => ({
  costPrice: row.costPrice,
  productionUnitCost: row.productionUnitCost ?? row.costPrice,
  marketingUnitCost: row.marketingUnitCost ?? 0,
  retailPrice: row.retailPrice,
  quantity: row.quantity,
}))
```

snapshot parser는 optional 필드를 제거하거나 덮어쓰지 않는다. 소비 지점이 `productionUnitCost ?? costPrice`, `marketingUnitCost ?? 0` fallback을 적용한다.

- [ ] **Step 6: 관련 테스트와 typecheck 실행**

Run: `npm test -- src/lib/sh/__tests__/price-group.test.ts src/lib/sh/__tests__/resolve-product-price-group.test.ts src/lib/sh/__tests__/pricing-scenario-snapshot.test.ts --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: 가격 시나리오 데이터 흐름 커밋**

```bash
git add src/lib/sh/price-group.ts src/lib/sh/resolve-product-price-group.ts src/lib/sh/__tests__/price-group.test.ts src/lib/sh/__tests__/resolve-product-price-group.test.ts src/components/sh/products/pricing-sim/pricing-bundle-row.tsx src/components/sh/products/pricing-sim/pricing-product-picker-dialog.tsx src/components/sh/products/pricing-sim/pricing-quick-flow.tsx src/lib/sh/pricing-scenario-snapshot.ts src/lib/sh/__tests__/pricing-scenario-snapshot.test.ts
git commit -m "feat: 가격 시나리오 원가 구성 보존"
```

---

### Task 7: 상품 옵션과 가격 시뮬레이션에 구성 표시

**Files:**

- Modify: `src/components/sh/products/product-options-table.tsx`
- Modify: `src/components/sh/products/pricing-sim/pricing-bundle-row.tsx`
- Modify: `src/components/sh/products/pricing-sim/pricing-cost-bar.tsx`
- Create: `src/components/sh/products/pricing-sim/__tests__/pricing-cost-bar.test.tsx`

- [ ] **Step 1: 비용 막대 segment 실패 테스트 작성**

```tsx
const cell = {
  discountRate: 0,
  finalPrice: 30_000,
  revenue: 27_272.73,
  cogs: 13_000,
  productionCogs: 10_000,
  marketingCogs: 3_000,
  vat: 2_727.27,
  fee: 0,
  channelFee: 0,
  paymentFee: 0,
  adCost: 0,
  shipping: 0,
  packaging: 0,
  operating: 0,
  returnCost: 0,
  totalCost: 13_000,
  netProfit: 14_272.73,
  margin: 0.4758,
  perUnitProfit: 14_272.73,
  tier: 'good' as const,
}

render(<PricingCostBar cell={cell} />)
expect(screen.getByText('생산원가')).toBeInTheDocument()
expect(screen.getByText('초기 마케팅비')).toBeInTheDocument()
expect(screen.queryByText(/^원가$/)).not.toBeInTheDocument()
```

- [ ] **Step 2: segment 테스트 실패 확인**

Run: `npm test -- src/components/sh/products/pricing-sim/__tests__/pricing-cost-bar.test.tsx --runInBand`

Expected: 새 label을 찾지 못해 FAIL.

- [ ] **Step 3: 비용 막대의 단일 원가 segment 분리**

`SegmentKey`의 `cogs`를 `productionCogs | marketingCogs`로 바꾸고 값은 각각 `cell.productionCogs`, `cell.marketingCogs`를 사용한다. 생산원가는 기존 slate 계열, 초기 마케팅비는 비용군과 구분되는 muted rose 계열 한 색만 사용한다. 임의의 강조색 토큰을 추가하지 않고 기존 inline palette 범위에서 선택한다.

- [ ] **Step 4: 상품 옵션과 시뮬레이션 행에 breakdown 표시**

`product-options-table.tsx`의 API 타입과 `productionCost` state를 새 breakdown으로 바꾼다. 생산차수 원가 연동 요약과 공급원가 tooltip에 다음 형식을 사용한다.

```text
생산원가 10,000원 + 초기 마케팅비 3,000원 = 공급원가 13,000원
```

`pricing-bundle-row.tsx`는 총원가 라인을 유지하고 `marketingUnitCost > 0`일 때만 작은 보조 텍스트로 같은 구성을 표시한다. 구성값이 없는 구 snapshot에는 보조 텍스트를 표시하지 않는다.

- [ ] **Step 5: UI 테스트와 typecheck 실행**

Run: `npm test -- src/components/sh/products/pricing-sim/__tests__/pricing-cost-bar.test.tsx --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: 원가 구성 표시 커밋**

```bash
git add src/components/sh/products/product-options-table.tsx src/components/sh/products/pricing-sim/pricing-bundle-row.tsx src/components/sh/products/pricing-sim/pricing-cost-bar.tsx src/components/sh/products/pricing-sim/__tests__/pricing-cost-bar.test.tsx
git commit -m "feat: 생산원가와 초기 마케팅비 구분 표시"
```

---

### Task 8: 통합 회귀 검증과 문서 정합성 확인

**Files:**

- Modify only if verification exposes a defect: files already listed in Tasks 1–7
- Review: `docs/decks/seller-hub/prd/2026-09-24-production-marketing-cost-design.md`

- [ ] **Step 1: seller-hub 관련 집중 테스트 실행**

Run:

```bash
npm test -- \
  src/lib/sh/__tests__/production-run-cost-schema.test.ts \
  src/lib/sh/__tests__/production-run-costs.test.ts \
  src/lib/sh/__tests__/production-cost-allocation.test.ts \
  src/lib/sh/__tests__/pricing-matrix-calc.test.ts \
  src/lib/sh/__tests__/price-group.test.ts \
  src/lib/sh/__tests__/resolve-product-price-group.test.ts \
  src/lib/sh/__tests__/pricing-scenario-snapshot.test.ts \
  src/components/sh/products/production/__tests__/production-run-form-dialog.test.tsx \
  src/components/sh/products/pricing-sim/__tests__/pricing-cost-bar.test.tsx \
  --runInBand
```

Expected: 모든 suite PASS.

- [ ] **Step 2: 정적 검증과 production build 실행**

Run: `npx prisma validate`

Expected: schema valid.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run lint`

Expected: exit 0, 새 error 없음.

Run: `npm run build`

Expected: Next.js production build 성공.

- [ ] **Step 3: 로컬 수동 검증**

Run: `npm run dev`

다음을 순서대로 확인한다.

1. 단일 상품 생산 차수에서 마케팅 분류를 선택하면 대상 상품이 자동 선택된다.
2. 다상품 생산 차수에서 대상 상품 없이는 저장되지 않는다.
3. 대상 상품의 모든 옵션을 제거하면 해당 마케팅 행이 오류 상태가 된다.
4. 입고완료 후 상품 옵션의 공급원가 tooltip이 생산원가와 초기 마케팅비를 분리한다.
5. 가격 시뮬레이션 비용 막대가 두 원가 segment를 표시하고 총원가·권장가·마진은 분리 전과 같다.
6. 기존 저장 가격 시나리오가 마케팅비 0원 fallback으로 정상 열린다.
7. 생산 차수 원가 표가 desktop/mobile 폭에서 가로 스크롤되고 열이 찌그러지지 않는다.

- [ ] **Step 4: 최종 diff와 migration 확인**

Run: `git diff --check`

Expected: 출력 없음.

Run: `git status --short`

Expected: 계획에 포함된 파일만 변경됨.

Run: `git diff --stat HEAD~7..HEAD`

Expected: Tasks 1–7의 기능·테스트 변경만 포함됨.

- [ ] **Step 5: 검증 중 수정이 있었다면 최종 커밋**

```bash
git add prisma app/api/sh src/lib/sh src/components/sh
git commit -m "fix: 초기 마케팅비 원가 반영 회귀 수정"
```

검증 중 수정이 없으면 빈 커밋을 만들지 않는다.
