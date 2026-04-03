/**
 * 단발성 수집 스크립트 — 수동 테스트용
 * 실행: npm run collect
 */
import 'dotenv/config'
import { runCollection } from './orchestrator.js'

async function main() {
  console.log(`[${new Date().toISOString()}] 수동 수집 시작`)

  try {
    await runCollection('manual')
    console.log(`[${new Date().toISOString()}] 수동 수집 완료`)
    process.exit(0)
  } catch (error) {
    console.error(`[${new Date().toISOString()}] 수동 수집 실패:`, error)
    process.exit(1)
  }
}

main()
