# 에이전트 제안 승인 운영

에이전트(MCP·내장 에이전트)가 데이터를 바꾸는 요청은 모두 승인 대기 큐(`AgentPendingAction`)에 쌓이고,
구성원이 승인한 뒤에만 실행된다. 에이전트는 승인할 수 없다(MCP 에 승인 도구 없음).

## 누가

- 기본: Space **ADMIN 이상**.
- 지출 제안(예산 키가 있는 Meta 변경 등): 금액이 Space **승인 한도**(`/settings/members` 의 "지출 승인 한도") 이하면
  ADMIN, 넘으면 **OWNER** 만. 한도가 없으면 모든 지출 제안이 OWNER 승인이다.
- GTM 게시는 OWNER.
- 승인 한도는 OWNER 가 2단계 인증 뒤 바꾼다.

## 어디서

- 웹: 제안 결과의 `approvalUrl`(승인 대기 화면).
- Slack: Space 승인 채널의 승인·거부 버튼. 버튼을 누른 Slack 계정 이메일로 구성원을 찾아 처음 한 번 연결한다.
  구성원이 아니면 본인에게만 보이는 안내가 뜬다.
- 터미널에서 제안했다면 `*_list_actions` 에 `actionId`·`waitSec` 를 주면 승인·실행 결과를 기다려 이어받는다.

## 사전 검증

- Meta create·update 제안은 큐에 넣기 전에 Meta `validate_only` 로 검증하고, 거부되면 제안이 만들어지지 않는다.
  `adstudy.*` 는 검증하지 않는다(Meta 가 무시하고 실제로 만든다).

## 급히 광고를 꺼야 할 때

1. 가장 빠른 길: Meta 광고 관리자에서 직접 끈다(workdeck 승인과 무관).
2. workdeck 경로: `campaign.update_status`/`adset.update_status`/`ad.update_status` 로 `PAUSED` 제안 →
   금액이 없어 ADMIN 이 바로 승인할 수 있다(Slack 버튼).
3. 끈 뒤 에이전트가 다시 켜지 않도록 대화·크론 지시를 정리한다.
