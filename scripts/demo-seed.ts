/**
 * 마케팅 랜딩 스크린샷용 데모 워크스페이스 합성 데이터 시드.
 *
 * 대상: 로컬 dev DB (.env.local의 DATABASE_URL/DIRECT_URL, supabase dev).
 * 신규 데모 유저(demo@workdeck.work) + 신규 워크스페이스/Space만 생성한다.
 * 기존 사용자/워크스페이스 데이터는 절대 건드리지 않는다 — 모든 삭제·재시드는
 * 이 데모 유저의 workspaceId/spaceId로만 스코프한다.
 *
 * 실행:
 *   npx tsx scripts/demo-seed.ts
 *
 * 재실행 시 idempotent — 기존 데모 워크스페이스/Space의 데이터를 정리하고 재시드한다.
 */
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

import { PrismaClient, type Prisma } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient } from '@supabase/supabase-js'
import { ensureWorkspaceForUser } from '../src/lib/workspace'
import { ensureFinanceSeeded } from '../src/lib/finance/kifrs-seed'
import { rebuildDerivedSnapshots } from '../src/lib/finance/snapshot-rebuild'
import { buildApplicationPii } from '../src/lib/hiring/pii'
import { DEFAULT_FEE_CATEGORY } from '../src/lib/sh/channel-fee-lookup'

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL 또는 DATABASE_URL 환경변수가 필요합니다')
const adapter = new PrismaPg({ connectionString, max: 5 })
const prisma = new PrismaClient({ adapter } as never)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다')
}
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const DEMO_EMAIL = 'demo@workdeck.work'
const DEMO_PASSWORD = 'WorkdeckDemo2026!'
const DEMO_WORKSPACE_NAME = '모던리빙'
const BRAND_NAME = '모던리빙'

const ALL_DECK_IDS = [
  'coupang-ads',
  'seller-hub',
  'sales-content',
  'finance',
  'recruiting',
  'blog-ops',
]

// ─── 유틸 ───────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function pick<T>(arr: T[]): T {
  return arr[rand(0, arr.length - 1)]!
}
function dateDaysAgo(days: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d
}

// ─── 0. Supabase 데모 유저 확보 ─────────────────────────────────────────────

async function ensureDemoAuthUser(): Promise<string> {
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  })
  if (!createErr && created.user) {
    console.log(`  ✔ Supabase auth user 신규 생성: ${created.user.id}`)
    return created.user.id
  }

  // 이미 존재 — 페이지네이션으로 이메일 매칭해 기존 id 확보 (admin API에 getUserByEmail 없음)
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const found = data.users.find((u) => u.email === DEMO_EMAIL)
    if (found) {
      console.log(`  ✔ Supabase auth user 기존 재사용: ${found.id}`)
      return found.id
    }
    if (data.users.length < 200) break
  }
  throw new Error(`데모 유저(${DEMO_EMAIL})를 생성하지도 찾지도 못했습니다: ${createErr?.message}`)
}

// ─── 1. 기존 데모 데이터 정리 (스코프: 이 유저의 workspace/space id만) ─────

async function cleanupExistingDemoData(userId: string) {
  const workspace = await prisma.workspace.findUnique({ where: { ownerId: userId } })
  if (workspace) {
    await prisma.workspace.delete({ where: { id: workspace.id } })
    console.log(`  ✔ 기존 Workspace(${workspace.id}) cascade 삭제`)
  }
  const membership = await prisma.spaceMember.findFirst({ where: { userId } })
  if (membership) {
    // HiringPostingPosition.spaceId FK는 onDelete: Cascade가 없어(스키마 기존 상태)
    // Space 직접 삭제 시 FK 위반이 난다 — 먼저 명시적으로 비운다.
    await prisma.hiringPostingPosition.deleteMany({ where: { spaceId: membership.spaceId } })
    await prisma.space.delete({ where: { id: membership.spaceId } })
    console.log(`  ✔ 기존 Space(${membership.spaceId}) cascade 삭제`)
  }
}

// ─── 2. coupang-ads: 캠페인 + AdRecord 30일치 ──────────────────────────────

async function seedCoupangAds(workspaceId: string) {
  const campaigns = [
    { id: 'demo-camp-keyword', name: '모던리빙 키워드검색광고' },
    { id: 'demo-camp-nca', name: '모던리빙 상품노출광고' },
    { id: 'demo-camp-brand', name: '모던리빙 브랜드검색광고' },
  ]
  const keywordsByCampaign: Record<string, string[]> = {
    'demo-camp-keyword': [
      '거실러그',
      '북유럽러그',
      '식탁매트',
      '극세사담요',
      '수납정리함',
      '주방정리대',
      '침구세트',
      '방석쿠션',
      '커튼원단',
      '조명스탠드',
      '욕실매트', // 저효율
      '캠핑담요', // 저효율
    ],
    'demo-camp-nca': [],
    'demo-camp-brand': ['모던리빙', '모던리빙공식스토어'],
  }
  const lowEfficiencyKeywords = new Set(['욕실매트', '캠핑담요'])

  const report = await prisma.reportUpload.create({
    data: {
      fileName: '모던리빙_광고리포트_데모.xlsx',
      periodStart: dateDaysAgo(30),
      periodEnd: dateDaysAgo(1),
      totalRows: 0,
      insertedRows: 0,
      duplicateRows: 0,
      skippedRows: 0,
      workspaceId,
    },
  })

  let inserted = 0
  const rows: Prisma.AdRecordCreateManyInput[] = []

  for (const campaign of campaigns) {
    await prisma.campaignMeta.create({
      data: {
        workspaceId,
        campaignId: campaign.id,
        displayName: campaign.name,
        isCustomName: false,
      },
    })

    for (let dayOffset = 30; dayOffset >= 1; dayOffset--) {
      const date = dateDaysAgo(dayOffset)
      const keywords = keywordsByCampaign[campaign.id]
      const entries = keywords.length > 0 ? keywords : [null] // NCA는 상품 단위(키워드 null)

      for (const keyword of entries) {
        const isLow = keyword != null && lowEfficiencyKeywords.has(keyword)
        const adCost = isLow ? rand(30000, 60000) : rand(30000, 150000)
        const roasPct = isLow ? rand(40, 90) : rand(150, 450)
        const impressions = rand(500, 8000)
        const clicks = Math.max(1, Math.round(impressions * (rand(5, 40) / 1000)))
        const revenue1d = Math.round((adCost * roasPct) / 100)
        const orders1d = Math.max(0, Math.round(revenue1d / rand(18000, 42000)))

        rows.push({
          date,
          adType: keyword ? '키워드 광고' : '상품 광고',
          campaignId: campaign.id,
          campaignName: campaign.name,
          adGroup: keyword ? `${campaign.name} 기본그룹` : null,
          placement: '검색 영역',
          productName: keyword ? null : '모던리빙 베스트 상품',
          optionId: keyword ? null : `OPT-${rand(1000, 9999)}`,
          keyword,
          impressions,
          clicks,
          adCost,
          ctr: Number((clicks / impressions).toFixed(4)),
          orders1d,
          revenue1d,
          roas1d: Number((roasPct / 100).toFixed(4)),
          material: null,
          workspaceId,
          reportId: report.id,
        })
      }
    }
  }

  // 대량 삽입 (unique 제약: workspaceId,date,campaignId,adType,keyword,adGroup,optionId)
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const result = await prisma.adRecord.createMany({ data: chunk, skipDuplicates: true })
    inserted += result.count
  }

  await prisma.reportUpload.update({
    where: { id: report.id },
    data: { totalRows: rows.length, insertedRows: inserted },
  })

  return { campaigns: campaigns.length, adRecords: inserted }
}

// ─── 3. seller-hub: 상품/옵션/재고/가격시뮬 ─────────────────────────────────

async function seedSellerHub(spaceId: string) {
  const brand = await prisma.brand.create({ data: { spaceId, name: BRAND_NAME } })
  const group = await prisma.invProductGroup.create({ data: { spaceId, name: '홈리빙' } })
  const location = await prisma.invStorageLocation.create({
    data: { spaceId, name: '본사 물류창고', type: 'OWN' },
  })

  const productDefs = [
    {
      name: '모던리빙 북유럽 거실러그',
      code: 'MLR-RUG-001',
      options: [
        { name: '150x200cm / 그레이', sku: 'MLR-RUG-001-GY', costPrice: 32000, retailPrice: 79000 },
        { name: '150x200cm / 베이지', sku: 'MLR-RUG-001-BG', costPrice: 32000, retailPrice: 79000 },
      ],
    },
    {
      name: '모던리빙 극세사 담요',
      code: 'MLR-BLK-002',
      options: [{ name: '150x200cm', sku: 'MLR-BLK-002-01', costPrice: 9800, retailPrice: 24900 }],
    },
    {
      name: '모던리빙 라탄 수납정리함 3종세트',
      code: 'MLR-STG-003',
      options: [{ name: '3종세트', sku: 'MLR-STG-003-01', costPrice: 15500, retailPrice: 38000 }],
    },
    {
      name: '모던리빙 리넨 침구 4종세트',
      code: 'MLR-BED-004',
      options: [
        { name: '퀸 / 아이보리', sku: 'MLR-BED-004-QIV', costPrice: 41000, retailPrice: 99000 },
        { name: '퀸 / 차콜', sku: 'MLR-BED-004-QCH', costPrice: 41000, retailPrice: 99000 },
      ],
    },
    {
      name: '모던리빙 우드 조명 스탠드',
      code: 'MLR-LGT-005',
      options: [{ name: '기본형', sku: 'MLR-LGT-005-01', costPrice: 22000, retailPrice: 55000 }],
    },
  ]

  let productCount = 0
  let optionCount = 0
  const createdOptions: { id: string; retailPrice: number; costPrice: number }[] = []

  for (const def of productDefs) {
    const product = await prisma.invProduct.create({
      data: {
        spaceId,
        name: def.name,
        code: def.code,
        groupId: group.id,
        brandId: brand.id,
        status: 'ACTIVE',
        internalName: def.name,
      },
    })
    productCount++
    for (const opt of def.options) {
      const option = await prisma.invProductOption.create({
        data: {
          productId: product.id,
          name: opt.name,
          sku: opt.sku,
          costPrice: opt.costPrice,
          retailPrice: opt.retailPrice,
          safetyStockQty: rand(5, 20),
        },
      })
      optionCount++
      createdOptions.push({ id: option.id, retailPrice: opt.retailPrice, costPrice: opt.costPrice })

      await prisma.invStockLevel.create({
        data: { spaceId, optionId: option.id, locationId: location.id, quantity: rand(20, 300) },
      })
      await prisma.invMovement.create({
        data: {
          spaceId,
          optionId: option.id,
          locationId: location.id,
          type: 'INBOUND',
          quantity: rand(50, 200),
          movementDate: dateDaysAgo(rand(5, 25)),
        },
      })
    }
  }

  // 가격 시뮬레이션 시나리오 1개 (대표 채널 하나 + 옵션 2개)
  let scenarioCount = 0
  try {
    const typeDef = await prisma.channelTypeDef.create({
      data: { spaceId, name: 'B2C', isSalesChannel: true, isSystem: false },
    })
    const channel = await prisma.channel.create({
      data: {
        spaceId,
        channelTypeDefId: typeDef.id,
        name: '쿠팡',
        useSimulation: true,
        applyAdCost: true,
        adCostPct: 0.08,
        shippingFeeType: 'FIXED',
        shippingFee: 3000,
        paymentFeeIncluded: true,
        paymentFeePct: 0.033,
      },
    })
    await prisma.channelFeeRate.create({
      data: { channelId: channel.id, categoryName: DEFAULT_FEE_CATEGORY, ratePercent: 10.8 },
    })

    const scenarioItems = createdOptions.slice(0, 2)
    const items = scenarioItems.map((opt) => {
      const salePrice = opt.retailPrice
      const channelFeePct = 0.108
      const shippingCost = 3000
      const adCostPct = 0.08
      const totalCost =
        opt.costPrice + shippingCost + salePrice * channelFeePct + salePrice * adCostPct
      const netProfit = Math.round(salePrice - totalCost)
      const revenueExVat = Math.round(salePrice / 1.1)
      return {
        optionId: opt.id,
        salePrice,
        channelFeePct,
        shippingCost,
        adCostPct,
        finalPrice: salePrice,
        revenueExVat,
        totalCost: Math.round(totalCost),
        netProfit,
        margin: revenueExVat > 0 ? Number((netProfit / revenueExVat).toFixed(4)) : 0,
      }
    })

    await prisma.pricingScenario.create({
      data: {
        spaceId,
        channelId: channel.id,
        name: '모던리빙 쿠팡 마진 시뮬레이션',
        productIds: [],
        includeVat: true,
        items: { create: items },
        channels: { create: [{ channelId: channel.id, sortOrder: 0 }] },
      },
    })
    scenarioCount = 1
  } catch (e) {
    console.warn('  ⚠ 가격시뮬 시나리오 생성 스킵:', (e as Error).message)
  }

  return { products: productCount, options: optionCount, pricingScenarios: scenarioCount }
}

// ─── 4. finance: 계좌 2개 + 거래내역 2개월치 ────────────────────────────────

async function seedFinance(spaceId: string) {
  await ensureFinanceSeeded(spaceId)

  const bank = await prisma.finAccount.create({
    data: {
      spaceId,
      name: '모던리빙 사업자 통장',
      holder: '모던리빙',
      kind: 'BANK',
      institution: '국민은행',
      accountNumber: '123456-04-123456',
      accountType: '보통예금',
      openingBalance: 20_000_000,
      currentBalance: 20_000_000,
      currentBalanceAsOf: dateDaysAgo(60),
    },
  })
  const card = await prisma.finAccount.create({
    data: {
      spaceId,
      name: '모던리빙 법인카드',
      holder: '모던리빙',
      kind: 'CARD',
      institution: '삼성카드',
      accountNumber: '5570-****-****-1234',
      accountType: '법인카드',
    },
  })

  // 분류 대상 리프 카테고리 확보 (kifrs-seed 트리 리프 이름 기준)
  const leafNames = {
    salesIncome: '온라인 판매정산',
    productCost: '상품 매입·사입',
    shipping: '택배비',
    ad: '광고비',
    payroll: '급여',
    rent: '임차료',
    tax: '세무·회계',
  }
  const categories = await prisma.finCategory.findMany({
    where: { spaceId, name: { in: Object.values(leafNames) } },
  })
  const catId = (name: string) => categories.find((c) => c.name === name)?.id ?? null

  type TxnDef = {
    accountId: string
    direction: 'IN' | 'OUT'
    amount: number
    description: string
    counterparty: string
    categoryName: string
    daysAgo: number
  }
  const defs: TxnDef[] = []

  // 은행: 매출 입금 (2개월간 20건 내외) + 고정비
  for (let m = 0; m < 2; m++) {
    for (let i = 0; i < 6; i++) {
      defs.push({
        accountId: bank.id,
        direction: 'IN',
        amount: rand(800000, 4200000),
        description: '쿠팡 정산입금',
        counterparty: '쿠팡(주)',
        categoryName: leafNames.salesIncome,
        daysAgo: m * 30 + rand(1, 28),
      })
    }
    defs.push({
      accountId: bank.id,
      direction: 'OUT',
      amount: rand(6000000, 8500000),
      description: '급여 이체',
      counterparty: '모던리빙 임직원',
      categoryName: leafNames.payroll,
      daysAgo: m * 30 + 25,
    })
    defs.push({
      accountId: bank.id,
      direction: 'OUT',
      amount: 1_500_000,
      description: '사무실 임차료',
      counterparty: '스페이스코리아',
      categoryName: leafNames.rent,
      daysAgo: m * 30 + 5,
    })
    defs.push({
      accountId: bank.id,
      direction: 'OUT',
      amount: rand(2500000, 5500000),
      description: '원자재 매입대금',
      counterparty: '모던패브릭',
      categoryName: leafNames.productCost,
      daysAgo: m * 30 + rand(8, 15),
    })
    defs.push({
      accountId: bank.id,
      direction: 'OUT',
      amount: 350000,
      description: '기장수수료',
      counterparty: '한빛세무회계',
      categoryName: leafNames.tax,
      daysAgo: m * 30 + 3,
    })
  }

  // 카드: 광고비 + 택배비 다건
  for (let m = 0; m < 2; m++) {
    for (let i = 0; i < 8; i++) {
      defs.push({
        accountId: card.id,
        direction: 'OUT',
        amount: rand(80000, 600000),
        description: '쿠팡 광고비 결제',
        counterparty: '쿠팡Wing광고',
        categoryName: leafNames.ad,
        daysAgo: m * 30 + rand(1, 28),
      })
    }
    for (let i = 0; i < 6; i++) {
      defs.push({
        accountId: card.id,
        direction: 'OUT',
        amount: rand(15000, 90000),
        description: 'CJ대한통운 택배비',
        counterparty: 'CJ대한통운',
        categoryName: leafNames.shipping,
        daysAgo: m * 30 + rand(1, 28),
      })
    }
  }

  defs.sort((a, b) => b.daysAgo - a.daysAgo)

  const runningBalance = new Map<string, number>([
    [bank.id, 20_000_000],
    [card.id, 0],
  ])

  let created = 0
  for (let idx = 0; idx < defs.length; idx++) {
    const d = defs[idx]!
    const prevBalance = runningBalance.get(d.accountId) ?? 0
    const nextBalance = d.direction === 'IN' ? prevBalance + d.amount : prevBalance - d.amount
    runningBalance.set(d.accountId, nextBalance)

    await prisma.finTransaction.create({
      data: {
        spaceId,
        accountId: d.accountId,
        txnDate: dateDaysAgo(d.daysAgo),
        direction: d.direction,
        amount: d.amount,
        balanceAfter: d.accountId === bank.id ? nextBalance : null,
        description: d.description,
        counterparty: d.counterparty,
        categoryId: catId(d.categoryName),
        classStatus: catId(d.categoryName) ? 'CLASSIFIED' : 'UNCLASSIFIED',
        identityKey: `demo-${d.accountId}-${idx}-${d.daysAgo}`,
        contentHash: `demo-hash-${idx}`,
      },
    })
    created++
  }

  await prisma.$transaction(async (tx) => {
    await rebuildDerivedSnapshots(tx, spaceId, [bank.id, card.id])
  })

  return { accounts: 2, transactions: created }
}

// ─── 5. recruiting (hiring): 채용공고 + 지원자 ─────────────────────────────

async function seedRecruiting(spaceId: string) {
  const store = await prisma.hiringStore.create({
    data: { spaceId, name: '모던리빙 본사', roadAddress: '서울특별시 성동구 성수이로 100' },
  })
  const position = await prisma.hiringPosition.create({
    data: { spaceId, name: 'MD/상품기획', category: '마케팅/MD' },
  })

  const postings = [
    {
      title: '[모던리빙] 이커머스 MD 채용',
      status: 'ACTIVE' as const,
    },
    {
      title: '[모던리빙] 콘텐츠 마케터 채용',
      status: 'DRAFT' as const,
    },
  ]

  let postingCount = 0
  let applicationCount = 0
  const entriesSchema = [
    { key: 'name', type: 'string', label: '이름', required: true },
    { key: 'phone', type: 'phone', label: '연락처', required: true },
    { key: 'email', type: 'email', label: '이메일', required: false },
    { key: 'custom_q1', type: 'text', label: '지원 동기', required: false },
  ]

  for (const p of postings) {
    const posting = await prisma.hiringPosting.create({
      data: {
        spaceId,
        title: p.title,
        status: p.status,
        applicationEntries: entriesSchema,
        publishedAt: p.status === 'ACTIVE' ? dateDaysAgo(10) : null,
      },
    })
    await prisma.hiringPostingStore.create({ data: { postingId: posting.id, storeId: store.id } })
    await prisma.hiringPostingPosition.create({
      data: {
        spaceId,
        postingId: posting.id,
        positionId: position.id,
        name: position.name,
        jobType: 'FULL_TIME',
        payFrequency: 'MONTHLY',
        payAmount: 3200000,
        headcount: 1,
      },
    })
    postingCount++

    if (p.status === 'ACTIVE') {
      const applicants = [
        { name: '김민지', phone: '01011112222', email: 'minji.kim@example.com' },
        { name: '이서준', phone: '01022223333', email: 'seojun.lee@example.com' },
        { name: '박지우', phone: '01033334444', email: 'jiwoo.park@example.com' },
        { name: '최하은', phone: '01044445555', email: 'haeun.choi@example.com' },
        { name: '정도윤', phone: '01055556666', email: 'doyoon.jung@example.com' },
      ]
      const stages: Array<'HIRING' | 'ACCEPTED' | 'REJECTED'> = [
        'HIRING',
        'HIRING',
        'HIRING',
        'ACCEPTED',
        'REJECTED',
      ]
      for (let i = 0; i < applicants.length; i++) {
        const a = applicants[i]!
        const { columns, sanitizedEntries } = buildApplicationPii([
          { key: 'name', type: 'string', label: '이름', value: a.name },
          { key: 'phone', type: 'phone', label: '연락처', value: a.phone },
          { key: 'email', type: 'email', label: '이메일', value: a.email },
          {
            key: 'custom_q1',
            type: 'text',
            label: '지원 동기',
            value: '브랜드 팬으로서 함께 성장하고 싶습니다.',
          },
        ])
        await prisma.hiringApplication.create({
          data: {
            spaceId,
            postingId: posting.id,
            applicationEntries: sanitizedEntries as unknown as Prisma.InputJsonValue,
            ...columns,
            stage: stages[i],
            hiringStage: 'APPLIED',
            referrer: pick(['jobkorea', 'saramin', 'wanted']),
            privacyAgreedAt: dateDaysAgo(rand(1, 8)),
          },
        })
        applicationCount++
      }
    }
  }

  return { postings: postingCount, applications: applicationCount }
}

// ─── 6. sales-content: 상품/페르소나/콘텐츠 최소 데이터 ────────────────────

async function seedSalesContent(spaceId: string) {
  await prisma.brandProfile.create({
    data: {
      spaceId,
      companyName: BRAND_NAME,
      shortDescription: '북유럽 감성의 홈리빙 브랜드',
      toneOfVoice: ['따뜻한', '신뢰감 있는', '트렌디한'],
    },
  })

  const persona = await prisma.persona.create({
    data: { spaceId, name: '자취 3년차 직장인 여성', jobTitle: '마케터', industry: 'IT' },
  })
  const product = await prisma.product.create({
    data: {
      spaceId,
      name: '모던리빙 북유럽 거실러그',
      oneLinerPitch: '먼지 걱정 없는 극세사 원단, 자취방을 카페처럼',
    },
  })
  await prisma.productPersona.create({ data: { productId: product.id, personaId: persona.id } })

  const contents = [
    { title: '거실러그 하나로 분위기 완전히 바꾸는 법', status: 'PUBLISHED' as const },
    { title: '자취방 인테리어 초보를 위한 홈리빙 가이드', status: 'DRAFT' as const },
    { title: '겨울철 극세사 담요 관리법', status: 'IN_REVIEW' as const },
  ]
  let contentCount = 0
  for (const c of contents) {
    await prisma.content.create({
      data: {
        spaceId,
        title: c.title,
        doc: { type: 'doc', content: [] },
        body: `${c.title} — 모던리빙 데모 콘텐츠 본문입니다.`,
        status: c.status,
        publishedAt: c.status === 'PUBLISHED' ? dateDaysAgo(5) : null,
      },
    })
    contentCount++
  }

  return { products: 1, personas: 1, contents: contentCount }
}

// ─── 7. blog-ops: 상품 + 소재 + 포스트 최소 데이터 ─────────────────────────

async function seedBlogOps(spaceId: string) {
  const product = await prisma.boProduct.create({
    data: {
      spaceId,
      name: '모던리빙 북유럽 거실러그',
      category: 'B2C',
      oneLinerPitch: '먼지 걱정 없는 극세사 원단, 자취방을 카페처럼',
      targetCustomer: '자취 3년차 직장인 여성',
    },
  })
  const material = await prisma.boMaterial.create({
    data: {
      spaceId,
      productId: product.id,
      title: '거실러그로 완성하는 북유럽 인테리어',
      appealPoint: '먼지·소음 걱정 없는 프리미엄 극세사',
      angle: '인테리어 팁',
      outline: [{ section: '도입', description: '자취방 분위기 고민' }],
      status: 'APPROVED',
    },
  })
  await prisma.boPost.create({
    data: {
      spaceId,
      materialId: material.id,
      title: '거실러그로 완성하는 북유럽 인테리어',
      doc: { type: 'doc', content: [] },
      bodyMarkdown: '# 거실러그로 완성하는 북유럽 인테리어\n\n모던리빙 데모 포스트 본문입니다.',
      status: 'DRAFT',
      targetKeyword: '거실러그 추천',
    },
  })

  return { products: 1, materials: 1, posts: 1 }
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 데모 워크스페이스 시드 시작')

  console.log('▸ Supabase 데모 유저 확보...')
  const userId = await ensureDemoAuthUser()

  console.log('▸ 기존 데모 데이터 정리 (스코프: 이 유저 소유 workspace/space만)...')
  await cleanupExistingDemoData(userId)

  console.log('▸ Workspace + Space 구조 생성 (coupang-ads 기본 활성)...')
  const { workspace } = await ensureWorkspaceForUser(
    { id: userId, email: DEMO_EMAIL, name: '모던리빙 데모' },
    DEMO_WORKSPACE_NAME
  )
  const membership = await prisma.spaceMember.findFirstOrThrow({ where: { userId } })
  const spaceId = membership.spaceId
  const workspaceId = workspace.id

  console.log('▸ 6개 Deck 전체 활성화...')
  for (const deckId of ALL_DECK_IDS) {
    await prisma.deckApp.upsert({
      where: { id: deckId },
      create: { id: deckId, name: deckId, isActive: true },
      update: { isActive: true },
    })
    await prisma.deckInstance.upsert({
      where: { spaceId_deckAppId: { spaceId, deckAppId: deckId } },
      create: { spaceId, deckAppId: deckId, isActive: true },
      update: { isActive: true },
    })
  }

  console.log('▸ coupang-ads 시드 중...')
  const coupangAds = await seedCoupangAds(workspaceId)

  console.log('▸ seller-hub 시드 중...')
  const sellerHub = await seedSellerHub(spaceId)

  console.log('▸ finance 시드 중...')
  const finance = await seedFinance(spaceId)

  console.log('▸ recruiting 시드 중...')
  const recruiting = await seedRecruiting(spaceId)

  console.log('▸ sales-content 시드 중...')
  const salesContent = await seedSalesContent(spaceId)

  console.log('▸ blog-ops 시드 중...')
  const blogOps = await seedBlogOps(spaceId)

  console.log('\n✅ 시드 완료\n')
  console.log(`계정: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  console.log(`User id: ${userId}`)
  console.log(`Workspace id (coupang-ads): ${workspaceId}`)
  console.log(`Space id (그 외 5개 Deck): ${spaceId}`)
  console.log('\n건수:')
  console.log('  coupang-ads:', coupangAds)
  console.log('  seller-hub:', sellerHub)
  console.log('  finance:', finance)
  console.log('  recruiting:', recruiting)
  console.log('  sales-content:', salesContent)
  console.log('  blog-ops:', blogOps)
}

main()
  .catch((e) => {
    console.error('❌ 시드 실패:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
