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
import { startAnalysisPoller } from './analysis-poller.js'
import { startWorkerHeartbeat } from './heartbeat.js'
import { startBackfillPoller } from './backfill-poller.js'
import { pruneScreenshots } from './screenshot-retention.js'

// playwright-extra 의 puppeteer 호환 shim 은 브라우저/페이지가 먼저 닫히면
// cdpSession.send 를 await 되지 않는 promise 에서 던진다. Node 기본 정책상 이 unhandled
// rejection 이 uncaughtException 으로 승격돼 워커 프로세스가 통째로 죽는다 —
// 2026-08-27 09시 수집이 이렇게 사망했다(판매분석 엑셀 다운로드 중 크래시 →
// 재고현황·판매분석 업로드 통째 유실, launchd 가 재시작했지만 그 회차는 복구 불가).
// 개별 수집은 각자 try/catch 로 실패 처리되므로 프로세스는 살려 둔다.
// uncaughtException 은 일부러 잡지 않는다 — 손상된 상태로 계속 도는 게 더 위험하고,
// 그 경우는 launchd 재시작이 옳다.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason)
  console.error(`[worker] unhandledRejection — 프로세스 유지: ${msg}`)
})

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

// 분석 폴링 시작
startAnalysisPoller()

// Heartbeat — Vercel cron이 다운 감지에 사용
startWorkerHeartbeat()

// 콜드스타트 백필 잡 폴링 시작
startBackfillPoller()

// 진단용 스크린샷 보존 정리 — 기동 시 1회 + 매일 04:00 KST(수집 09:00 과 겹치지 않게)
pruneScreenshots()
cron.schedule('0 4 * * *', pruneScreenshots, { timezone: 'Asia/Seoul' })

console.log('크론 스케줄러 + 수동 수집 폴링 대기 중...\n')
