# AI 공급자 선택 — BYOK / 워크덱 제공

워크스페이스마다 AI 텍스트 생성을 **사용자 보유 키(BYOK)** 또는 **워크덱 제공 AI(무료 쿼터)** 중 하나로 쓴다.
설정 위치는 `/settings/ai` 한 곳이고 워크스페이스 전체(세일즈 콘텐츠·블로그·발주 등)에 적용된다.

## 배경

`generateTextWithFallback`(`src/lib/ai/providers/index.ts`)의 체인은 codex CLI → gemini CLI → Ollama다.
앞의 둘은 로컬 바이너리 존재 여부로 가용성을 판정하고 Ollama 기본값은 `127.0.0.1`이라,
**Vercel 서버리스에서는 셋 다 동작하지 않는다.** 배포 환경에서 AI를 쓰려면 SaaS 경로가 필요했다.

## 동작

진입점은 `generateTextForSpace(spaceId, req)` (`src/lib/ai/resolve.ts`). 결정 순서는 다음과 같다.

| 조건 | 결과 mode | 쿼터 차감 |
|---|---|---|
| `SpaceAiSetting.mode = BYOK` | `BYOK` — 저장된 provider·키로 호출 | 안 함(사용자 부담) |
| BYOK 아님 + 로컬 CLI 바이너리 존재 | `LOCAL_CLI` — 개발 환경 편의 | 안 함 |
| BYOK 아님 + 서버 env 키 존재 | `WORKDECK` | **함** |
| 위 어느 것도 없음 | `AiNotConfiguredError` | — |

**BYOK는 폴백하지 않는다.** 사용자가 고른 공급자가 실패하면 그대로 에러를 올리고 `lastError`에 기록한다.
조용히 워크덱 쿼터로 넘어가면 비용 주체가 뒤바뀌고, 사용자는 자기 키가 고장난 사실을 모르게 된다.

## 쿼터

`WorkspaceAiCredit.textTokensUsed / textTokenQuota` (월 단위, UTC 기준 `currentYearMonth`).
이미지와 달리 호출 전에 소비량을 알 수 없어 **호출 전 잔량 확인 → 호출 후 실제 usage 누적** 방식이다.
마지막 호출이 쿼터를 조금 넘겨 끝날 수 있으나(최대 1회분), 사용자를 중간에 끊지 않는 편이 낫고 다음 호출에서 차단된다.

기본값 30만 토큰/월 — `WORKDECK_TEXT_MONTHLY_TOKEN_QUOTA`로 조정한다. **실사용 로그를 보고 정해야 하는 값이다.**

## 키 보관

`SpaceAiSetting.encryptedApiKey` + `apiKeyIv`, AES-256-CBC(`ENCRYPTION_KEY`).
`src/lib/del/encryption.ts`의 `encryptPii`/`decryptPii`를 그대로 쓴다 — `ChannelCredential`과 같은 방식이다.

**키는 어떤 API 응답에도 넣지 않는다.** `GET /api/settings/ai`는 `hasKey: boolean`만 내보내고,
`apiKeyIv`는 select조차 하지 않는다. 응답 객체를 spread하지 말고 필드를 나열할 것 — spread하면 암호문이 샌다.

## 환경변수

| 변수 | 용도 |
|---|---|
| `GOOGLE_AI_API_KEY` | 워크덱 제공 AI 1순위(Gemini). 이미지 생성과 공용 |
| `OPENAI_API_KEY` | 워크덱 제공 AI 2순위 |
| `ANTHROPIC_API_KEY` | 워크덱 제공 AI 3순위. Slack 에이전트와 공용 |
| `WORKDECK_TEXT_MONTHLY_TOKEN_QUOTA` | 월 무료 토큰(기본 300000) |
| `AI_SAAS_TIMEOUT_MS` | SaaS 어댑터 공통 타임아웃(기본 60000) |

셋 다 없으면 워크덱 제공 모드가 동작하지 않고, 설정 화면에 그 사실이 표시된다.

## 주의

- **`maxTokens`·`temperature`가 이제 실효를 갖는다.** codex/gemini CLI는 두 값을 무시해 왔으므로,
  SaaS로 전환한 호출부는 출력 길이·품질이 달라질 수 있다.
- **워커는 이 설정을 모른다.** `worker/src/analysis-poller.ts`는 프로세스 전역 env로 동작한다.
  워커에도 적용하려면 웹앱 API 경유(`worker/src/sc/insight-generator.ts` 방식)로 바꿔야 한다.
- 전환된 호출부는 sales-content 4곳(온보딩 초안·아이데이션·본문 생성·인사이트)이다.
  블로그(`src/lib/bo/*`)와 발주(`app/api/sh/inventory/reorder/*`)는 아직 로컬 체인을 쓴다.
