// sc 워커 CLI 엔트리포인트.
// 실행: tsx src/sc/index.ts (worker/ 디렉토리 기준)
// 환경변수: WORKER_API_KEY, WEB_APP_URL (기본 http://127.0.0.1:3000)
import 'dotenv/config'
import { runScLoop } from './runner.js'

runScLoop().catch((err) => {
  console.error('[sc-worker] 치명적 오류:', err)
  process.exit(1)
})
