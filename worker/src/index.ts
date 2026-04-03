/**
 * Worker 진입점 — 크론 스케줄러
 * 매일 12:30 KST에 쿠팡 광고 리포트를 자동 수집한다.
 */
import 'dotenv/config'
import cron from 'node-cron'
import { runCollection } from './orchestrator.js'

const CRON_SCHEDULE = '30 12 * * *' // 매일 12:30 KST

console.log('=== Workdeck Worker 시작 ===')
console.log(`API URL: ${process.env.WORKDECK_API_URL}`)
console.log(`스케줄: ${CRON_SCHEDULE} (매일 12:30 KST)`)
console.log(`Headless: ${process.env.HEADLESS !== 'false'}`)

// 크론 스케줄 등록 (KST = Asia/Seoul)
cron.schedule(
  CRON_SCHEDULE,
  async () => {
    console.log(`\n[${new Date().toISOString()}] 스케줄 수집 시작`)
    try {
      await runCollection('scheduled')
      console.log(`[${new Date().toISOString()}] 스케줄 수집 완료`)
    } catch (error) {
      console.error(`[${new Date().toISOString()}] 스케줄 수집 실패:`, error)
    }
  },
  {
    timezone: 'Asia/Seoul',
  }
)

console.log('크론 스케줄러 대기 중...\n')
