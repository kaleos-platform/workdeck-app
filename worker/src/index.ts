/**
 * Worker 진입점 — 크론 스케줄러
 * 매 분 DB 수집 스케줄을 확인하여 시각 일치 시 수집을 실행한다.
 * 매 정시에 분석 스케줄을 확인하고 조건 충족 시 자동 분석을 트리거한다.
 */
import 'dotenv/config'
import cron from 'node-cron'
import { runCollection } from './orchestrator.js'
import { checkAndRunCollection } from './collection-scheduler.js'
import { checkAndRunAnalysis } from './analysis-scheduler.js'
import { startManualPoller } from './manual-poller.js'

console.log('=== Workdeck Worker 시작 ===')
console.log(`API URL: ${process.env.WORKDECK_API_URL}`)
console.log(`수집 스케줄: DB 기반 (매 분 체크)`)
console.log(`분석 스케줄 체크: 매 정시`)
console.log(`Headless: ${process.env.HEADLESS !== 'false'}`)

// 크론 스케줄 등록 — 데이터 수집 (매 분 DB 스케줄 확인)
cron.schedule(
  '* * * * *',
  async () => {
    try {
      await checkAndRunCollection(runCollection)
    } catch (error) {
      console.error(`[${new Date().toISOString()}] 수집 스케줄 체크 실패:`, error)
    }
  },
  { timezone: 'Asia/Seoul' }
)

// 크론 스케줄 등록 — 분석 자동 스케줄 체크 (매 정시)
cron.schedule(
  '0 * * * *',
  async () => {
    console.log(`\n[${new Date().toISOString()}] 분석 스케줄 체크 시작`)
    try {
      await checkAndRunAnalysis()
      console.log(`[${new Date().toISOString()}] 분석 스케줄 체크 완료`)
    } catch (error) {
      console.error(`[${new Date().toISOString()}] 분석 스케줄 체크 실패:`, error)
    }
  },
  { timezone: 'Asia/Seoul' }
)

// 수동 수집 폴링 시작
startManualPoller()

console.log('크론 스케줄러 + 수동 수집 폴링 대기 중...\n')
