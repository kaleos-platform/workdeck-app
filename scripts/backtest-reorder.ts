/**
 * 발주 예측 백테스트 스크립트
 *
 * 운영 DB에서 최근 120일 출고 이력을 읽어 모델별 예측 정확도를 검증한다.
 * - 훈련 구간: 처음 90일
 * - holdout 구간: 마지막 30일
 * - 평가 지표: WAPE, Bias%
 * - 출력: 콘솔 테이블 + scripts/backtest-results.json
 *
 * 실행:
 *   vercel env pull --environment=production --scope eddysangwon-gmailcoms-projects /tmp/.workdeck-prod-env --yes
 *   PROD_DATABASE_URL=$(grep '^DATABASE_URL=' /tmp/.workdeck-prod-env | cut -d= -f2- | tr -d '"') \
 *     npx tsx --tsconfig tsconfig.json scripts/backtest-reorder.ts
 *
 * 주의: prisma.config.ts 가 .env.local을 override:true로 로드하기 때문에 prisma를 경유하지 않고
 *       PROD_DATABASE_URL 환경변수를 직접 node-postgres(pg)로 연결한다.
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'

// ── 운영 DB 연결 ──────────────────────────────────────────────────────────────

const PROD_DATABASE_URL = process.env.PROD_DATABASE_URL
if (!PROD_DATABASE_URL) {
  console.error(
    '❌  PROD_DATABASE_URL 환경변수가 없습니다.\n' +
      '   vercel env pull 후 PROD_DATABASE_URL=... npx tsx ... 형식으로 실행하세요.'
  )
  process.exit(1)
}

// ESM 환경에서 node_modules/pg를 스크립트 파일 위치 기준으로 찾지 못하므로 절대경로 사용
const pgPath = resolve(process.cwd(), 'node_modules/pg/lib/index.js')
const { default: pg } = await import(pgPath)

const pool = new pg.Pool({ connectionString: PROD_DATABASE_URL, max: 5 })

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect()
  try {
    const res = await client.query(sql, params)
    return res.rows as T[]
  } finally {
    client.release()
  }
}

// ── 예측 모듈 (로컬 import) ───────────────────────────────────────────────────

import { buildDailySeries, forecastOption } from '../src/lib/inv/forecast/index.js'
import { forecastHoltWinters } from '../src/lib/inv/forecast/holt-winters.js'
import { forecastCroston } from '../src/lib/inv/forecast/croston.js'
import { forecastBayesian } from '../src/lib/inv/forecast/bayesian.js'
import type { DailyOutbound } from '../src/lib/inv/forecast/types.js'

// ── 상수 ─────────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 120 // 전체 분석 창
const TRAIN_DAYS = 90 // 훈련 구간
const HOLDOUT_DAYS = 30 // holdout 구간
const SAMPLE_OPTIONS = 30 // 매출 상위 옵션 샘플 수

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function wape(forecast: number, actual: number): number {
  return actual > 0 ? Math.abs(forecast - actual) / actual : 0
}

function biasPct(forecast: number, actual: number): number {
  return actual > 0 ? (forecast - actual) / actual : 0
}

// 가중 평균 WAPE (실제 출고량 가중)
function weightedWape(pairs: Array<{ forecast: number; actual: number }>): number {
  const totalActual = pairs.reduce((s, p) => s + p.actual, 0)
  if (totalActual === 0) return 0
  const weightedSum = pairs.reduce((s, p) => s + Math.abs(p.forecast - p.actual), 0)
  return weightedSum / totalActual
}

function weightedBias(pairs: Array<{ forecast: number; actual: number }>): number {
  const totalActual = pairs.reduce((s, p) => s + p.actual, 0)
  if (totalActual === 0) return 0
  const weightedSum = pairs.reduce((s, p) => s + (p.forecast - p.actual), 0)
  return weightedSum / totalActual
}

// ── 타입 ──────────────────────────────────────────────────────────────────────

type OutboundRow = {
  option_id: string
  movement_date: Date
  quantity: number
}

type TopOptionRow = {
  option_id: string
  space_id: string
  total_qty: number
}

type ModelResult = {
  forecast: number
  actual: number
  wape: number
  bias: number
}

type OptionResult = {
  optionId: string
  spaceId: string
  trainQty: number
  holdoutQty: number
  sma: ModelResult
  hw: ModelResult
  croston: ModelResult
  bayes: ModelResult
  hybrid: ModelResult
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 발주 예측 백테스트 시작 ===\n')

  const now = new Date()
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const trainEnd = new Date(now.getTime() - HOLDOUT_DAYS * 24 * 60 * 60 * 1000)

  console.log(`전체 창: ${toDateStr(windowStart)} ~ ${toDateStr(now)}`)
  console.log(`훈련: ${toDateStr(windowStart)} ~ ${toDateStr(trainEnd)} (${TRAIN_DAYS}일)`)
  console.log(`holdout: ${toDateStr(trainEnd)} ~ ${toDateStr(now)} (${HOLDOUT_DAYS}일)\n`)

  // 1) 매출 상위 옵션 30개 선택 (최근 120일 OUTBOUND 기준)
  console.log(`매출 상위 ${SAMPLE_OPTIONS}개 옵션 조회 중...`)
  const topOptions = await query<TopOptionRow>(
    `
    SELECT
      m."optionId" AS option_id,
      m."spaceId" AS space_id,
      SUM(m.quantity)::int AS total_qty
    FROM "InvMovement" m
    WHERE m.type = 'OUTBOUND'
      AND m."movementDate" >= $1
    GROUP BY m."optionId", m."spaceId"
    ORDER BY total_qty DESC
    LIMIT $2
    `,
    [windowStart, SAMPLE_OPTIONS]
  )

  if (topOptions.length === 0) {
    console.error('❌  OUTBOUND 이력이 없습니다. 운영 DB 연결을 확인하세요.')
    await pool.end()
    process.exit(1)
  }

  console.log(`  → ${topOptions.length}개 옵션 선택됨\n`)

  const optionIds = topOptions.map((r) => r.option_id)

  // 2) 전체 120일 일별 출고 데이터 조회
  console.log('출고 이력 조회 중...')
  const movements = await query<OutboundRow>(
    `
    SELECT
      m."optionId" AS option_id,
      m."movementDate" AS movement_date,
      m.quantity::int AS quantity
    FROM "InvMovement" m
    WHERE m."optionId" = ANY($1::text[])
      AND m.type = 'OUTBOUND'
      AND m."movementDate" >= $2
    ORDER BY m."movementDate" ASC
    `,
    [optionIds, windowStart]
  )

  console.log(`  → ${movements.length}건 이동 이력 로드\n`)

  // 옵션별 날짜 맵 구성
  const outboundByOption = new Map<string, Record<string, number>>()
  for (const mv of movements) {
    const dateKey = toDateStr(new Date(mv.movement_date))
    const byDate = outboundByOption.get(mv.option_id) ?? {}
    byDate[dateKey] = (byDate[dateKey] ?? 0) + mv.quantity
    outboundByOption.set(mv.option_id, byDate)
  }

  // 3) 옵션별 모델 평가
  const results: OptionResult[] = []

  console.log('모델별 예측 평가 중...\n')

  for (const optRow of topOptions) {
    const optionId = optRow.option_id
    const spaceId = optRow.space_id
    const allOutbound = outboundByOption.get(optionId) ?? {}

    // 훈련 구간 (처음 90일)
    const trainSeries = buildDailySeries(allOutbound, TRAIN_DAYS, trainEnd)

    // holdout 실제 출고 합계
    const holdoutSeries: DailyOutbound[] = []
    for (let i = 0; i < HOLDOUT_DAYS; i++) {
      const d = new Date(trainEnd.getTime() + (i + 1) * 24 * 60 * 60 * 1000)
      const key = toDateStr(d)
      holdoutSeries.push({ date: key, qty: allOutbound[key] ?? 0 })
    }
    const actualHoldout = holdoutSeries.reduce((s, d) => s + d.qty, 0)
    const trainQty = trainSeries.reduce((s, d) => s + d.qty, 0)

    // 각 모델의 예측 일평균 → holdout 기간 예측 총량
    const hwResult = forecastHoltWinters(trainSeries)
    const crostonResult = forecastCroston(trainSeries)
    const bayesResult = forecastBayesian(trainSeries)
    const hybridResult = forecastOption({ history: trainSeries, leadTimeDays: HOLDOUT_DAYS })

    // SMA 베이스라인: 단순 훈련 구간 평균
    const smaDaily = trainQty / TRAIN_DAYS
    const smaForecast = smaDaily * HOLDOUT_DAYS

    const hwForecast = hwResult.dailyAvg * HOLDOUT_DAYS
    const crostonForecast = crostonResult.dailyAvg * HOLDOUT_DAYS
    const hybridForecast = hybridResult.dailyAvg * HOLDOUT_DAYS

    const makeModelResult = (forecast: number, actual: number): ModelResult => ({
      forecast,
      actual,
      wape: wape(forecast, actual),
      bias: biasPct(forecast, actual),
    })

    const bayesForecast = bayesResult.dailyAvg * HOLDOUT_DAYS

    results.push({
      optionId,
      spaceId,
      trainQty,
      holdoutQty: actualHoldout,
      sma: makeModelResult(smaForecast, actualHoldout),
      hw: makeModelResult(hwForecast, actualHoldout),
      croston: makeModelResult(crostonForecast, actualHoldout),
      bayes: makeModelResult(bayesForecast, actualHoldout),
      hybrid: makeModelResult(hybridForecast, actualHoldout),
    })
  }

  // 4) 집계
  const models = ['sma', 'hw', 'croston', 'bayes', 'hybrid'] as const

  type AggRow = {
    model: string
    wape: number
    bias: number
    improvement: string
  }

  const aggRows: AggRow[] = models.map((model) => {
    const pairs = results.map((r) => ({ forecast: r[model].forecast, actual: r[model].actual }))
    return {
      model: model.toUpperCase(),
      wape: weightedWape(pairs),
      bias: weightedBias(pairs),
      improvement: '', // 나중에 채움
    }
  })

  // SMA 대비 개선율 계산
  const smaWape = aggRows.find((r) => r.model === 'SMA')!.wape
  for (const row of aggRows) {
    if (row.model === 'SMA') {
      row.improvement = '-'
    } else {
      const imp = smaWape > 0 ? ((smaWape - row.wape) / smaWape) * 100 : 0
      row.improvement = `${imp >= 0 ? '+' : ''}${imp.toFixed(1)}%`
    }
  }

  // 5) 콘솔 출력
  console.log('=== 모델별 집계 결과 ===\n')
  console.log(
    `${'모델'.padEnd(10)}${'WAPE'.padStart(10)}${'Bias%'.padStart(10)}${'vs SMA'.padStart(12)}`
  )
  console.log('─'.repeat(42))
  for (const row of aggRows) {
    console.log(
      `${row.model.padEnd(10)}${(row.wape * 100).toFixed(1).padStart(9)}%${(row.bias * 100).toFixed(1).padStart(9)}%${row.improvement.padStart(12)}`
    )
  }

  const hybridRow = aggRows.find((r) => r.model === 'HYBRID')!
  const hybridWape = hybridRow.wape
  const hybridImpPct = smaWape > 0 ? ((smaWape - hybridWape) / smaWape) * 100 : 0

  console.log('\n=== 목표 검증 ===')
  const wapeTarget = hybridWape < 0.3
  const improvTarget = hybridImpPct >= 20
  console.log(
    `하이브리드 WAPE < 30%: ${(hybridWape * 100).toFixed(1)}% → ${wapeTarget ? '✅ 달성' : '❌ 미달'}`
  )
  console.log(
    `SMA 대비 WAPE ≥20% 개선: ${hybridImpPct.toFixed(1)}% → ${improvTarget ? '✅ 달성' : '❌ 미달'}`
  )

  // 6) 옵션별 상세 (상위 10개)
  console.log('\n=== 옵션별 상세 (하이브리드 WAPE 상위 10) ===\n')
  const sorted = [...results].sort((a, b) => b.hybrid.wape - a.hybrid.wape).slice(0, 10)
  console.log(
    `${'optionId'.padEnd(28)}${'holdout실제'.padStart(12)}${'SMA'.padStart(10)}${'HW'.padStart(10)}${'Hybrid'.padStart(10)}`
  )
  console.log('─'.repeat(70))
  for (const r of sorted) {
    const shortId = r.optionId.slice(-12)
    console.log(
      `...${shortId.padEnd(25)}${r.holdoutQty.toString().padStart(12)}${(r.sma.wape * 100).toFixed(0).padStart(9)}%${(r.hw.wape * 100).toFixed(0).padStart(9)}%${(r.hybrid.wape * 100).toFixed(0).padStart(9)}%`
    )
  }

  // 7) JSON 저장
  const output = {
    runAt: now.toISOString(),
    config: {
      windowDays: WINDOW_DAYS,
      trainDays: TRAIN_DAYS,
      holdoutDays: HOLDOUT_DAYS,
      sampleOptions: topOptions.length,
    },
    aggregate: aggRows.map((r) => ({
      model: r.model,
      wapePercent: parseFloat((r.wape * 100).toFixed(2)),
      biasPercent: parseFloat((r.bias * 100).toFixed(2)),
      vsSmaPctImprovement: r.improvement,
    })),
    goals: {
      hybridWapeLt30pct: wapeTarget,
      hybridImprovementGt20pct: improvTarget,
    },
    options: results.map((r) => ({
      optionId: r.optionId,
      spaceId: r.spaceId,
      trainQty: r.trainQty,
      holdoutQty: r.holdoutQty,
      sma: {
        wape: parseFloat((r.sma.wape * 100).toFixed(2)),
        bias: parseFloat((r.sma.bias * 100).toFixed(2)),
      },
      hw: {
        wape: parseFloat((r.hw.wape * 100).toFixed(2)),
        bias: parseFloat((r.hw.bias * 100).toFixed(2)),
      },
      croston: {
        wape: parseFloat((r.croston.wape * 100).toFixed(2)),
        bias: parseFloat((r.croston.bias * 100).toFixed(2)),
      },
      bayes: {
        wape: parseFloat((r.bayes.wape * 100).toFixed(2)),
        bias: parseFloat((r.bayes.bias * 100).toFixed(2)),
      },
      hybrid: {
        wape: parseFloat((r.hybrid.wape * 100).toFixed(2)),
        bias: parseFloat((r.hybrid.bias * 100).toFixed(2)),
      },
    })),
  }

  const outPath = resolve(process.cwd(), 'scripts/backtest-results.json')
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`\n결과 저장: ${outPath}`)

  await pool.end()
  console.log('\n=== 백테스트 완료 ===')
}

main().catch((e) => {
  console.error('❌  백테스트 실패:', e)
  pool.end().catch(() => {})
  process.exit(1)
})
