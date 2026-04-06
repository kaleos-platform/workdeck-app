import 'dotenv/config'
import { App } from '@slack/bolt'
import { registerHandlers } from './slack-handler'
import { startNotifier } from './notifier'
import { startHeartbeat } from './heartbeat'

// Slack Bolt 앱 초기화 (Socket Mode)
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
})

// 메시지 핸들러 등록
registerHandlers(app)

// 서버 시작
;(async () => {
  await app.start()
  console.log('에밀리 에이전트가 시작되었습니다. (#agent-amely-work)')

  // DB 설정 동기화 + heartbeat
  await startHeartbeat()

  // 자동 알림 폴링 시작
  startNotifier(app)
})()
