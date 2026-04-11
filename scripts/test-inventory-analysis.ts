/**
 * 재고 분석 기능 테스트 스크립트
 * 테스트 데이터를 삽입 → 분석 → 검증 → 정리
 * 실행: npx tsx --tsconfig tsconfig.json scripts/test-inventory-analysis.ts
 */
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

import { prisma } from '../src/lib/prisma.js'

const WORKSPACE_ID = 'cmmc74abv000004jmap96b7k3'
const SNAPSHOT_DATE = new Date('2026-04-11')

async function main() {
  console.log('=== 재고 분석 테스트 시작 ===\n')

  // 1. 테스트 업로드 레코드 생성
  const upload = await prisma.inventoryUpload.create({
    data: {
      workspaceId: WORKSPACE_ID,
      fileName: 'test-inventory.xlsx',
      fileType: 'INVENTORY_HEALTH',
      snapshotDate: SNAPSHOT_DATE,
      totalRows: 8,
    },
  })
  console.log(`테스트 업로드 생성: ${upload.id}`)

  // 2. 테스트 재고 레코드 삽입
  const testRecords = [
    // 재고 부족: 재고(5) - 판매(30) + 입고(10) = -15 → 필요 15개
    { productId: 'P001', optionId: 'O001', productName: '테스트상품A', optionName: '빨강', availableStock: 5, salesQty30d: 30, inboundStock: 10, returns30d: 1, revenue30d: 150000, storageFee: 3000, isItemWinner: true },
    // 재고 부족: 재고(0) - 판매(20) + 입고(0) = -20 → 필요 20개
    { productId: 'P002', optionId: 'O002', productName: '테스트상품B', optionName: '파랑', availableStock: 0, salesQty30d: 20, inboundStock: 0, returns30d: 0, revenue30d: 100000, storageFee: 2000, isItemWinner: true },
    // 반품율 높음: 5/10 = 50%
    { productId: 'P003', optionId: 'O003', productName: '테스트상품C', optionName: '초록', availableStock: 50, salesQty30d: 10, inboundStock: 0, returns30d: 5, revenue30d: 50000, storageFee: 1000, isItemWinner: true },
    // 보관료 주의 (매출 없음 + 보관료 높음)
    { productId: 'P004', optionId: 'O004', productName: '테스트상품D', optionName: null, availableStock: 100, salesQty30d: 0, inboundStock: 0, returns30d: 0, revenue30d: 0, storageFee: 8000, isItemWinner: false },
    // 보관료 주의 (보관료율 15%)
    { productId: 'P005', optionId: 'O005', productName: '테스트상품E', optionName: '대형', availableStock: 30, salesQty30d: 5, inboundStock: 0, returns30d: 0, revenue30d: 20000, storageFee: 3000, isItemWinner: true },
    // 위너 미달성 (재고 있는데 위너 아님)
    { productId: 'P006', optionId: 'O006', productName: '테스트상품F', optionName: '소형', availableStock: 80, salesQty30d: 15, inboundStock: 5, returns30d: 1, revenue30d: 75000, storageFee: 2000, isItemWinner: false },
    // 정상 상품 (이슈 없음)
    { productId: 'P007', optionId: 'O007', productName: '테스트상품G', optionName: null, availableStock: 200, salesQty30d: 10, inboundStock: 50, returns30d: 0, revenue30d: 300000, storageFee: 5000, isItemWinner: true },
    // 제외될 상품 (이슈가 있지만 제외 처리)
    { productId: 'P008', optionId: 'O008', productName: '테스트상품H-제외', optionName: null, availableStock: 0, salesQty30d: 50, inboundStock: 0, returns30d: 10, revenue30d: 0, storageFee: 10000, isItemWinner: false },
  ]

  await prisma.inventoryRecord.createMany({
    data: testRecords.map((r) => ({
      workspaceId: WORKSPACE_ID,
      snapshotDate: SNAPSHOT_DATE,
      fileType: 'INVENTORY_HEALTH',
      uploadId: upload.id,
      ...r,
    })),
  })
  console.log(`테스트 레코드 ${testRecords.length}건 삽입`)

  // 3. 제외 상품 등록 (O008)
  await prisma.inventoryExcludedProduct.create({
    data: { workspaceId: WORKSPACE_ID, productId: 'P008', optionId: 'O008' },
  })
  console.log('제외 상품 등록: O008\n')

  // 4. 분석 실행
  const { analyzeInventory } = await import('../src/lib/inventory-analyzer.js')
  const output = await analyzeInventory({ workspaceId: WORKSPACE_ID })

  if (!output) {
    console.error('❌ analyzeInventory 반환값이 null')
    await cleanup(upload.id)
    return
  }

  // 5. 검증
  let passed = true

  // 재고 부족: P001(필요15), P002(필요20) = 2건
  console.log('--- 재고 부족 ---')
  console.log(`  결과: ${output.shortageCount}건, 기대: 2건`)
  if (output.shortageCount !== 2) { passed = false; console.log('  ❌ FAIL') }
  else {
    // P002가 필요량이 더 크므로 먼저
    const first = output.results.stockShortage[0]
    if (first.optionId !== 'O002' || first.requiredRestockQty !== 20) {
      console.log(`  ❌ 정렬 오류: ${first.optionId} ${first.requiredRestockQty}`)
      passed = false
    } else {
      console.log('  ✅ PASS')
    }
  }

  // 반품율: P003(50%) = 1건
  console.log('--- 반품율 ---')
  console.log(`  결과: ${output.returnRateCount}건, 기대: 1건`)
  if (output.returnRateCount !== 1) { passed = false; console.log('  ❌ FAIL') }
  else {
    const item = output.results.returnRate[0]
    if (item.optionId !== 'O003' || item.returnRatePct !== 50) {
      console.log(`  ❌ 값 오류: ${item.optionId} ${item.returnRatePct}%`)
      passed = false
    } else {
      console.log('  ✅ PASS')
    }
  }

  // 보관료: P004(매출없음+8000원), P005(15%) = 2건
  console.log('--- 보관료 ---')
  console.log(`  결과: ${output.storageFeeCount}건, 기대: 2건`)
  if (output.storageFeeCount !== 2) { passed = false; console.log('  ❌ FAIL') }
  else {
    // P004 보관료 8000 > P005 보관료 3000
    const first = output.results.storageFee[0]
    if (first.optionId !== 'O004' || first.reason !== 'NO_SALES_HIGH_STORAGE') {
      console.log(`  ❌ 값 오류: ${first.optionId} ${first.reason}`)
      passed = false
    } else {
      console.log('  ✅ PASS')
    }
  }

  // 위너 미달성: P004(위너아님+재고100), P006(위너아님+재고80) = 2건
  // P008은 제외되어야 함
  console.log('--- 위너 미달성 ---')
  console.log(`  결과: ${output.winnerIssueCount}건, 기대: 2건`)
  if (output.winnerIssueCount !== 2) { passed = false; console.log('  ❌ FAIL') }
  else {
    // P004 재고100 > P006 재고80
    const first = output.results.winnerStatus[0]
    if (first.optionId !== 'O004') {
      console.log(`  ❌ 정렬 오류: ${first.optionId}`)
      passed = false
    } else {
      console.log('  ✅ PASS')
    }
  }

  // 제외 상품 검증: P008이 어떤 카테고리에도 없어야 함
  console.log('--- 제외 상품 ---')
  const allOptionIds = [
    ...output.results.stockShortage.map((i) => i.optionId),
    ...output.results.returnRate.map((i) => i.optionId),
    ...output.results.storageFee.map((i) => i.optionId),
    ...output.results.winnerStatus.map((i) => i.optionId),
  ]
  if (allOptionIds.includes('O008')) {
    console.log('  ❌ 제외 상품 O008이 결과에 포함됨')
    passed = false
  } else {
    console.log('  ✅ PASS — O008 제외 확인')
  }

  // 6. DB 저장 테스트
  console.log('\n--- DB 저장 테스트 ---')
  const { runAndSaveInventoryAnalysis } = await import('../src/lib/inventory-analyzer.js')
  const saved = await runAndSaveInventoryAnalysis({
    workspaceId: WORKSPACE_ID,
    triggeredBy: 'test',
    sendSlack: false,
  })

  if (!saved) {
    console.log('  ❌ 저장 실패')
    passed = false
  } else {
    const record = await prisma.inventoryAnalysis.findUnique({ where: { id: saved.analysisId } })
    if (!record) {
      console.log('  ❌ DB 레코드 없음')
      passed = false
    } else {
      console.log(`  분석 ID: ${record.id}`)
      console.log(`  triggeredBy: ${record.triggeredBy}`)
      console.log(`  counts: ${record.shortageCount}/${record.returnRateCount}/${record.storageFeeCount}/${record.winnerIssueCount}`)
      if (
        record.shortageCount === 2 &&
        record.returnRateCount === 1 &&
        record.storageFeeCount === 2 &&
        record.winnerIssueCount === 2
      ) {
        console.log('  ✅ PASS')
      } else {
        console.log('  ❌ FAIL — counts 불일치')
        passed = false
      }
      // 저장된 분석 삭제
      await prisma.inventoryAnalysis.delete({ where: { id: saved.analysisId } })
    }
  }

  // 7. 정리
  await cleanup(upload.id)

  console.log(`\n=== 테스트 결과: ${passed ? '✅ 모든 테스트 통과' : '❌ 일부 실패'} ===`)
  if (!passed) process.exit(1)
}

async function cleanup(uploadId: string) {
  await prisma.inventoryRecord.deleteMany({ where: { uploadId } })
  await prisma.inventoryUpload.delete({ where: { id: uploadId } })
  await prisma.inventoryExcludedProduct.deleteMany({
    where: { workspaceId: WORKSPACE_ID, optionId: 'O008' },
  })
  console.log('\n테스트 데이터 정리 완료')
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => process.exit(0))
