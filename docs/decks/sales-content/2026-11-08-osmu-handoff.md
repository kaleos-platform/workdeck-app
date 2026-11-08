# OSMU 파이프라인 — 작업 인계 (2026-11-08)

설계: [`2026-11-08-osmu-source-pipeline.md`](./2026-11-08-osmu-source-pipeline.md) — **§10(Codex 리뷰 반영)이 본문보다 우선.**

## 작업 위치

| 용도              | 경로 / 식별자                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 개발 워크트리     | `/Users/kaleos/projects/kaleos/workdeck-app-sc-osmu` (브랜치 `feat/sc-osmu-p1`, `docs/sc-osmu-design` 위, develop 기준, **미푸시**)                                                                                   |
| 건드리지 말 것    | `workdeck-app-sales-content` (공유, 남의 미커밋 `.codex/config.toml`·`.gemini/settings.json`), `workdeck-runner` (운영 워커, 배포 때만)                                                                               |
| GCP 프로젝트      | `workdeck-drive-photos` (번호 380076288367, 칼레오스 조직)                                                                                                                                                            |
| WIF               | 풀 `vercel` / 공급자 `vercel`, issuer `https://oidc.vercel.com/eddysangwon-gmailcoms-projects`, 조건 `assertion.project == 'workdeck-app'`                                                                            |
| 공유 드라이브     | 「[미닝랩] 미디어 라이브러리」 `0ADqnN-QTzXVbUk9PVA` (현재 비어 있음)                                                                                                                                                 |
| 노션 예시         | 업무 DB `2dc74629-c38a-805b-93a2-dbee5d169aa2`, 주간 「블로그 작성」 페이지 `3c374629c38a806f9dbdca9328d88ba2`                                                                                                        |
| 스파이크 스크립트 | `/private/tmp/claude-501/-Users-kaleos-projects-kaleos-workdeck-app-sales-content/3202a736-7120-450b-b064-a85a6a19d173/scratchpad/spike.mjs` (OIDC→STS→SA 생성→generateAccessToken→Drive). 임시 폴더라 재부팅 시 소멸 |

## 1. 사용자 준비 (개발 착수 전)

- [x] 노션 내부 통합 「Workdeck」 생성 + 상위 페이지 「콘텐츠 파이프라인」(`41274629c38a803dbad3cbac47cfb9d7`) 연결. 토큰은 맥미니 `~/.config/workdeck/notion-token`(600)
- [x] DB 2개 API 로 생성(2026-11-08): 콘텐츠 소재 db `e675b3b7-a798-4a9e-b694-09633f808eeb` / ds `02b6ee55-283c-4416-bb60-8bd1e90fbbe5`, 콘텐츠 발행 db `720a5363-ba3b-488e-b3b6-7c98d7886e46` / ds `f7e7fee6-7c8d-4cde-9bbb-599161f06eb9`. 「상태」 select 옵션 9개 선생성. 시험 행 각 1개([시험], 발행 행 상태 비움, 미디어 폴더 비움)
- [ ] 공유 드라이브에 시험용 행사 폴더 1개 + 사진 업로드
- [x] `gcloud auth login hello@kaleos.co.kr --no-activate --no-launch-browser` 재로그인 (기본 계정은 `hello@ameaning.co.kr` 유지)

## 2. GCP 정리 (재로그인 후, 항상 `--account=hello@kaleos.co.kr`)

- [x] WIF 공급자 조건 강화: `assertion.project == 'workdeck-app' && assertion.owner == 'eddysangwon-gmailcoms-projects'`
- [x] TokenCreator 를 프로젝트 단위 → SA 단위 부여로 전환 (§10) — 2026-11-08 프로젝트 바인딩 제거, principalSet 엔 serviceAccountAdmin 만 남음(SA 단위 부여는 `ensureSpaceServiceAccount` 가 생성 직후 수행)
- [x] 스파이크 SA `wd-spike-5219yg@…` 삭제(2026-11-08) — [ ] 공유 드라이브 구성원 목록에 남은 삭제 계정 항목은 드라이브 화면에서 사용자가 제거
- [ ] 스크래치패드 `.devenv`(Vercel dev 환경변수, 비밀값 포함) 삭제 — 2026-11-08 세션에서 자동 모드가 삭제를 막음, 사용자가 직접 삭제

## 3. P1 개발 — 블로그 OSMU (§8·§10)

### 진행 현황 (2026-11-08, `feat/sc-osmu-p1` 7커밋)

| #   | 항목                                                                                           | 상태                   |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | Prisma 모델 + RLS (`20261108120000_sc_osmu_sources`, dev DB 적용)                              | ✅                     |
| 2   | 연결 화면: 설정 > 「소재 연결」 탭, `PUT /api/sc/osmu/connections`(ADMIN+MFA)                  | ✅ 코드, 실연동 미검증 |
| 3   | 수신 cron `/api/cron/sc-osmu-intake`(10분, 240s 예산, lease·backoff)                           | ✅ 가짜 노션 e2e       |
| 4   | 소재 정규화(항목=노션 속성, 사실·인용만 AI + evidence substring 검증, 해시 같으면 버전 재사용) | ✅                     |
| 5   | 드라이브 동기화(공유 드라이브 root 안만) + AI 설명·얼굴 판정(애매하면 FACE)                    | ✅ 코드, 실연동 미검증 |
| 6   | MCP `sc_list_requests`·`sc_get_source`, `sc_propose_post` 의 `requestId`·`photos`              | ✅                     |
| 7   | 승인 시트 사진 자리 썸네일 + 사실·근거 (`OsmuReviewSection`)                                   | ✅ 렌더 테스트만       |
| 8   | 노션 상태 projection(상태=**select** 속성, 라벨 같으면 안 씀)                                  | ✅                     |
| 9   | Aside 연결 — 승인 시 소재 사진으로 모든 자리 차면 `saveAssetPlan(complete)`                    | ✅ e2e                 |
| 10  | 에밀리 스킬 갱신 + `docker restart`                                                            | ⬜ 배포 후             |

설계 결정(본문과 다른 점)

- 노션 「상태」는 `status` 가 아니라 **`select`** 속성. 연결은 DB 링크를 받아 서버가 data source id 로 해석(API 2025-09-03).
- 제안 시점 사진 복사본은 `ScMediaCopy(requestId, mediaId, md5)` — Content 가 아직 없어서 ContentAsset 에 못 둠. 승인 트랜잭션에서 ContentAsset 으로 만들고 자리를 미리 채운다.
- 요청 state: RECEIVED → (NEEDS_INPUT) → READY → PROPOSED → APPROVED(이후 노션 상태는 배포 상태에서 파생) / CANCELED / FAILED.
- 드라이브 허용 root 는 **공유 드라이브 id** 만(하위 폴더 조상 탐색 안 함).

남은 일·알려진 한계

- 실연동 검증: 노션 통합·DB 2개 생성(속성 이름은 `src/lib/sc/osmu/notion-schema.ts` 고정) → 연결 → 드라이브 계정 만들기 → SA 이메일을 공유 드라이브 뷰어로 추가 → root 등록 → 「작성 요청」 1건으로 끝까지.
- 드라이브 썸네일·파일 목록은 스파이크에서도 미검증(드라이브가 비어 있었음).
- NEEDS_INPUT/FAILED 는 노션 「확인 필요」로만 알림 — Slack 알림 미구현.
- 사진 설명 실패(`describeError`)는 재시도 안 함, 형식 오류는 UNKNOWN(게시 불가) — 사람 허용 UI 미구현(`allowedByUserId/At/Md5` 컬럼만).
- `targetUrl` 은 여전히 필수(§10 의 채널 기본 링크 정책 미구현). 희망 발행일 → scheduledAt 은 에이전트가 넣는다.
- 승인 거부 시 요청은 PROPOSED 그대로(재제안 허용).
- 확인 필요·실패·승인 전 취소 요청을 사람이 다시 「작성 요청」으로 바꾸면 새 snapshot 으로 재시작. 그 밖의 사람 상태 수정(승인 후 취소 포함)은 다음 cron 에 실제 상태로 덮어쓴다(「취소 무시됨」 전용 표시는 없음).
- 실연동 때 확인: 처음 보는 select 옵션 이름(예: 「사진 대기」)으로 페이지 PATCH 하면 옵션이 자동 생성되는지. 안 되면 설정 안내에 「상태」 옵션 9개 미리 만들기를 추가.
- 로컬 e2e: `set -a; . ./.env.local; set +a; npx jest -c jest.config.e2e.ts --runInBand src/lib/sc/osmu`. 전체 jest 의 기존 실패 4종(nbaesong settings·use-user·worker 3)은 base 에서도 실패.

1. Prisma 모델: `ScNotionConnection`, `ScDriveConnection`, `ScSource`, `ScSourceVersion`, `ScMedia`(faceStatus UNKNOWN/NO_FACE/FACE), `ScPublishRequest`(unique `(spaceId, notionPageId)`, lease·attempts·snapshot), `Content.sourceVersionId` — `migrate dev` 만
2. 연결 화면: 노션 토큰 등록, 드라이브 SA 자동 생성·이메일 표시(런타임 OIDC = `@vercel/oidc` `getVercelOidcToken()`)
3. 인입 cron: 노션 「콘텐츠 발행」 → `ScPublishRequest` (인입 시 Content 생성 안 함), 커서·시간 예산 배치
4. 소재 정규화: 노션 블록 → `ScSourceVersion` (근거 substring 보존)
5. 드라이브 동기화 + AI 캡션·얼굴 판정 (기본 NO_FACE 만 게시 허용)
6. MCP: `sc_get_source`, `sc_list_requests`, `sc_propose_post` 에 `requestId`·`photos` (제안 시점에 storage 복사, md5)
7. 웹 승인: 자리별 썸네일 + 근거 표시 → 승인 시 Content 생성·요청 연결
8. 노션 상태 되쓰기(projection): 사진 대기 / 임시저장 확인 필요 / 확인 필요 / 게시 완료(URL 확인 후)
9. Aside 게시 연결 (기존 AWAITING_ASSETS·리허설·`publishAttemptedAt` 재사용)
10. 에밀리 스킬 갱신 → MCP 배포 후 `docker restart aml-hermes-emily-hermes-1`

릴리스: 워크트리 → develop PR(squash) → main 기준 `release/*` 에 cherry-pick → main PR. `git cherry` 로 확인.

## 4. 기존 잔여 (OSMU 와 별개)

- [ ] Aside 리허설 2건 확인 → ASIDE 채널 autoPublish 켜기 → 첫 실제 발행 검증 (현재 prod autoPublish=false)
- [ ] 맥미니 네이버 로그인 유지 상태 관찰
- [ ] GA4 전환 등록
- [ ] 후순위: URL 완료 MCP 도구, 월간 통계, brandId 연결, 메뉴 정리, 배포 대기 중 「게시됨」 숨김
- [ ] 사용자 확인: 파일럿 글 「개금고」 표기, 상품명 문장 중복

## 지켜야 할 규칙

- prod DB 쓰기·`prisma db push` 금지. prod 조회는 `vercel env pull` → 사용 후 env 파일 삭제
- `ENCRYPTION_KEY` 변경 금지, 비밀값 출력 금지(접두어·길이만)
- `git add -A` 금지, 파일 명시 스테이징. 세션별 별도 워크트리
- 사실 창작 금지(근거 없는 내용 발행 금지), 네이버 비밀번호 입력 금지
