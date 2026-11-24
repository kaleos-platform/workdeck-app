# 광고 분석 실패 알림 + Gemini 402 예비 모델 전환

## 목표
AI 광고 분석이 Gemini 402(크레딧 소진)로 2주간 조용히 실패했다. 키·결제 오류도 로컬 Ollama로 넘기고, 최종 실패는 Slack으로 알린다.

## 변경 파일
- `worker/src/analysis-poller.ts`
  - `callAnalysisAI`: 문자열 `includes('5')` 판정 제거. 오류 메시지 `Gemini [NNN]`에서 상태 코드 추출.
    - flash 실패: 401·402·403(같은 키 문제) → pro 건너뛰고 Ollama. 그 밖(429·5xx·네트워크·파싱 실패 등) → pro.
    - pro 실패 → 항상 Ollama(로컬이라 비용 없음).
    - 전부 실패하면 단계별 오류를 합친 메시지로 throw(402 정보가 Ollama 오류에 가려지지 않게).
  - 실패 처리 분리 `handleAnalysisFailure(reportId, workspaceId, err)`: `/complete` FAILED 저장 + `notifyAnalysisFailed` 호출(발송 실패는 삼킴).
- `worker/src/slack-notifier.ts`: `notifyAnalysisFailed({ error, workspaceId })` — 사유 한 줄 + 분석 화면 링크, 402/401/403이면 "Gemini 크레딧/키 확인 필요". eventKey `analysis_failed`.
- `src/lib/slack/notification-events.ts`: coupang-ads에 `analysis_failed`(togglable=false) 추가 — 다른 실패 이벤트와 같은 규약(마스터 토글만).
- `worker/src/__tests__/analysis-poller.test.ts`: 402 → Ollama, 429 → pro, 실패 시 notify 호출.

## 하루 1회 제한
예약 분석이 하루 1회(09:10)라 자연히 1회. 별도 중복 억제 없음(수동 재실행 시 실패마다 알림 — 사용자가 직접 누른 것이라 허용).

## 검증
- 워커 `tsc --noEmit`, jest(신규 테스트).
- 배포 후 운영 워커 체크아웃 갱신 + `launchctl kickstart -k gui/$(id -u)/ai.workdeck.coupang-worker`.

## 롤백
커밋 revert 후 워커 재시작. DB 변경 없음.

## 범위 밖
컨텍스트 빌드(`/run`) 실패 경로(FAILED 미저장), 키워드 제외 후보 화면, AI 제안 내용.

## Codex 리뷰 반영 (지적 5건 — 반영 4, 절차로 대응 1)
1. [반영] Ollama가 성공해도 401·402·403이면 경고 알림("Gemini 크레딧/키 확인 필요, 로컬 모델로 분석됨"). `callAnalysisAI` 결과에 `geminiKeyError`를 담는다.
2. [반영] 하루 1회 가정 폐기 — `analysisHour=null`이면 실패 후 매 정시 재시도된다. 워커 메모리에 `workspaceId+사유` 기준 KST 하루 1회 억제(재시작 시 초기화, 허용).
3. [절차] PROCESSING 정체는 기존 문제. 배포 전 워커 로그에 진행 중 분석이 없는지 확인 후 kickstart. 운영 체크아웃은 `/Users/kaleos/projects/kaleos/workdeck-runner`.
4. [반영] FAILED 저장 HTTP 응답 확인·로그, 저장 실패와 무관하게 알림 시도. Slack 발송 false도 로그.
5. [반영] `/run`이 500 + `status: FAILED`를 돌려주면(컨텍스트 빌드 실패, 서버가 이미 FAILED 저장) 알림만 보낸다.
