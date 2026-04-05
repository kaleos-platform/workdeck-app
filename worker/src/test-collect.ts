/**
 * 수집 테스트 스크립트 — API 없이 직접 Playwright 수집 테스트
 * 실행: npx tsx src/test-collect.ts
 */
import 'dotenv/config'
import { collectCoupangReport } from './collector.js'

const COUPANG_ID = 'ameaning22'
const COUPANG_PW = 'znemqpfj26!'

async function main() {
  console.log('=== 쿠팡 광고 데이터 수집 테스트 ===')
  console.log(`ID: ${COUPANG_ID}`)
  console.log(`브라우저: ${process.env.HEADLESS === 'true' ? 'headless' : 'headed'}`)
  console.log('')

  try {
    const result = await collectCoupangReport({
      loginId: COUPANG_ID,
      password: COUPANG_PW,
    })

    console.log('')
    console.log('✅ 수집 성공!')
    console.log(`파일: ${result.filePath}`)
    console.log(`파일명: ${result.fileName}`)
  } catch (error) {
    console.error('')
    console.error('❌ 수집 실패:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
