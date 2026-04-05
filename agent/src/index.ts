import 'dotenv/config'
import { App } from '@slack/bolt'
import { registerHandlers } from './slack-handler'

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
  console.log('워크덱 에이전트가 시작되었습니다.')
})()
