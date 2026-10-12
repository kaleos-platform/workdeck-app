/**
 * Slack mrkdwn 에 사용자·에이전트 입력을 넣을 때 쓰는 이스케이프.
 * `<!channel>`, `<@U…>`, `<url|text>` 같은 제어 구문이 실제 멘션·링크로 해석되지 않게 한다.
 * `&` 를 먼저 바꿔 이중 이스케이프를 막는다. 자를 때는 먼저 자르고 나중에 이스케이프한다.
 */
export function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
