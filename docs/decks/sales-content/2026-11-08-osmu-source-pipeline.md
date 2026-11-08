# 1 소스 멀티 유즈 콘텐츠 파이프라인 (노션 소재 · 드라이브 미디어 · Workdeck 제작)

- 작성: 2026-11-08 · 상태: 설계 확정(사용자 인터뷰), Codex 리뷰 전
- 관련: [2026-10-18-ax-transition-plan.md](2026-10-18-ax-transition-plan.md), Aside 자동 게시(#1301·#1304)

## 1. 목표

사람은 **미디어(드라이브)와 사실(노션)만 한 번 등록**한다. 에이전트(에밀리)가 그 원본에서 블로그·보도자료·SNS 등
여러 결과물을 만들고, 사람은 승인만 한다. 텍스트 결과물을 먼저 만들고, 이미지·영상은 승인된 텍스트를 바탕으로 만든다.

## 2. 확정된 결정

| # | 결정 |
|---|---|
| 1 | 미디어 파일은 구글 공유 드라이브(「[미닝랩] 미디어 라이브러리」)의 **행사별 폴더**. 폴더엔 미디어만, 문서는 노션 |
| 2 | 드라이브 연결 = **워크스페이스별 서비스 계정**(자동 생성) + 폴더/드라이브 공유. 키 없음 — Vercel OIDC → GCP Workload Identity Federation → SA impersonate (§6) |
| 3 | 노션 DB 2개로 분리: **「콘텐츠 소재」**(사실, 시간 불변) / **「콘텐츠 발행」**(요청 1건 = 행 1개, 자기 일정·상태) |
| 4 | 착수 트리거 = 「콘텐츠 발행」 행 상태 **「작성 요청」**. 연결된 소재에 미디어가 없으면 Slack 으로 사람에게 질문 |
| 5 | 노션은 **입력 창구**. 가져올 때 서식 제거 + 항목 정규화해 **Workdeck 「소재」(버전 관리)** 에 저장. 결과물은 항상 이 정규화 원본에서 채널 포맷으로 생성 — 노션 서식은 발행물에 영향 없음 |
| 6 | 한 소재로 결과물 여러 개(블로그 2편 등) 가능. 같은 블로그 내 유사 문서는 네이버 노출 저하 → 관점·구성·사진 차별화 + 겹침 경고 |
| 7 | 승인 = 발행 행 단위, 같은 날 요청된 행은 한 화면에 묶어 표시. 시각물 행은 「바탕 결과물」(텍스트) 승인 후 착수 |
| 8 | 얼굴이 식별되는 사진은 기본 게시 불가(사진별 허용 토글), 승인 썸네일로 2차 확인 |
| 9 | 급할 땐 Slack 으로 에밀리에게 사진·메모 → 에밀리가 노션 소재·드라이브에 대신 등록(같은 경로로 합류) |

## 3. SSOT (데이터 종류별 원본 1곳)

| 데이터 | SSOT | 다른 곳 |
|---|---|---|
| 미디어 파일 | 구글 드라이브 | Workdeck: 목록·AI 설명·썸네일(사본), 게시 시 사용 사진만 storage 복사 |
| 사람이 쓴 소재 원문 | 노션 「콘텐츠 소재」 | — (편집 창구) |
| **제작용 소재(정규화·버전)** | **Workdeck ScSource/ScSourceVersion** | 결과물이 참조 |
| 발행 요청(유형·관점·희망일) | 노션 「콘텐츠 발행」 → 수신 즉시 Workdeck Content 로 등록 | 노션엔 상태·링크 되쓰기 |
| 결과물 본문·버전·승인·게시·링크·성과 | Workdeck Content/Deployment | 노션엔 상태·결과 링크만(보기 전용) |

충돌 규칙
- 노션 발행 행 상태: 사람은 「작성 요청」「취소」만. 그 외(작성 중·승인 대기·예약·게시 완료·확인 필요)와 결과 링크는 Workdeck 만 쓴다.
- 결과물 수정은 Workdeck 에서만. 노션에 결과물 본문을 복사하지 않는다.
- 요청 후 소재 수정 → 이후 작성분부터 반영(재가져오기 = 새 버전). 게시된 글 수정은 새 발행 요청.

```
 사람 입력                            Workdeck (실행·기록)                       채널
 드라이브 행사 폴더 ──읽기(SA)──▶  ScMedia (사진 목록·AI 설명·얼굴)
 노션 [콘텐츠 소재] ──가져오기──▶  ScSource vN (정규화·근거 문장)
 노션 [콘텐츠 발행] ──요청 수신─▶  Content(TODO, sourceVersion) ─에밀리 MCP─▶ 제안
          ▲                                  │ 승인(웹, 썸네일)
          └──────── 상태·링크 되쓰기 ◀───────┤
                                             └─ Deployment ─Aside 워커─▶ 네이버 블로그 …
```

## 4. 노션 스키마 (Workdeck 이 생성, 이름 고정)

**콘텐츠 소재** — 제목(행사명) · 행사일(date) · 장소/대상(text) · 기관(text) · 사용 상품(multi_select 또는 text) · 미디어 폴더(url, 드라이브 링크) · 본문(자유: 행사 내용·사실·인용·보도자료 원문)

**콘텐츠 발행** — 제목 · 소재(relation→콘텐츠 소재) · 유형(select: 블로그/보도자료/인스타그램/스레드/영상 대본/카드뉴스…) · 관점·요청 사항(text) · 희망 발행일(date) · 바탕 결과물(relation→콘텐츠 발행, 시각물용) · 상태(status) · 결과 링크(url) · Workdeck 링크(url)

## 5. Workdeck 데이터 모델 (마이그레이션)

- `ScSource { id, spaceId, notionPageId @unique(space), title, driveFolderId?, latestVersion, lastImportedAt }`
- `ScSourceVersion { id, sourceId, version, data Json, rawText Text, contentHash, createdAt, @@unique([sourceId, version]) }`
  - `data`: `{ fields: {eventDate, place, audience, org, products[]}, facts: [{text, evidence}], quotes: [{speaker, text, evidence}] }`
  - `evidence` 는 rawText 의 **원문 부분 문자열** — 저장 전 결정적 검증(substring), 실패 항목 폐기(창작 방지)
- `ScMedia { id, spaceId, sourceId?, driveFileId @unique(space), driveFolderId, path, name, mimeType, md5, driveModifiedAt, takenAt?, width?, height?, caption?, tags Json, hasFace?, allowPublish(false→설명 후 !hasFace), describedAt?, describeError?, removedAt? }`
- `ScDriveConnection { spaceId @unique, serviceAccountEmail }`
- `Content` 추가: `sourceId?`, `sourceVersion?`, `notionRequestPageId? @unique(space)`, `requestKind?`, `basedOnContentId?`
- 노션 자격증명: 기존 Space credential 저장소(암호화) 재사용, 키 `notion` (P1 은 내부 통합 토큰 — 워크스페이스 소유자가 통합 생성 후 두 DB 공유)

## 6. 드라이브 인증 (스파이크 검증 완료 2026-11-06~08)

- GCP 프로젝트 `workdeck-drive-photos`(kaleos.co.kr 조직, 칼레오스 소유). 조직 정책 `iam.disableServiceAccountKeyCreation` 으로 **키 생성 불가** → 키 없는 구조 채택.
- WIF 풀 `vercel` / OIDC 공급자 `vercel` (issuer `https://oidc.vercel.com/eddysangwon-gmailcoms-projects`, 조건 `project == workdeck-app`). principalSet(attribute.project/workdeck-app) 에 `serviceAccountAdmin` + `serviceAccountTokenCreator`.
- 런타임: `VERCEL_OIDC_TOKEN` → STS token-exchange → IAM API 로 Space SA 생성 → iamcredentials `generateAccessToken`(drive.readonly, 600s). 신규 바인딩/SA 는 전파에 1~3분 → 재시도 필요.
- 공유 드라이브: `supportsAllDrives`·`includeItemsFromAllDrives`·`corpora=drive&driveId=` 필수. SA 를 드라이브 구성원(뷰어)으로 추가하면 `drives.list` 에 보임(canListChildren·canDownload 확인). 실제 파일 목록·썸네일 다운로드는 드라이브에 파일이 생긴 뒤 재검증.
- SA 한도: 프로젝트당 기본 100 → 초과 시 증설.

## 7. 처리 흐름

1. **수신(cron 10분)**: 노션 「콘텐츠 발행」에서 상태=작성 요청 조회 → 행마다 노션 상태 「작성 중」으로 선점(조건부, 중복 방지) → 소재 가져오기(블록→평문, 해시 같으면 버전 재사용, 다르면 AI 정규화 + evidence 검증 → 새 버전) → 미디어 폴더 동기화(신규 파일 AI 설명) → 미디어 0장 & 사진 필요한 유형이면 Slack 질문 + 노션 「확인 필요」 → 아니면 Content(TODO, sourceVersion, notionRequestPageId) 생성 → 에밀리 호출(Slack 멘션 또는 에밀리 cron 의 `sc_list_requests`).
2. **작성(에밀리)**: `sc_get_source(contentId)` → 정규화 데이터 + 미디어(설명·allowPublish) + 같은 소재의 기존 결과물 요약 → 플레이북·템플릿대로 작성 → `sc_propose_post({contentId, …, photos:[{slot, mediaId}]})`.
3. **승인(웹)**: photos/소재 기반 제안은 길이 무관 웹 승인. 자리별 썸네일, 사실 문장별 근거 표시, 유사 결과물 겹침 경고. 노션 「승인 대기」.
4. **게시**: 승인 → AWAITING_ASSETS 생성 → (트랜잭션 밖) 드라이브 사진 storage 복사 → 기존 `saveAssetPlan`(전 자리 채움이면 complete) → 기존 Aside 경로(리허설 포함). 노션 「예약/게시 완료」+결과 링크.
5. **시각물**: 바탕 결과물 승인 후 착수(P3).

## 8. 단계

- **P1 (블로그 OSMU)**: 노션 DB 2개 생성 · 노션/드라이브 연결 설정 화면 · 수신 cron · 소재 정규화·버전 · 드라이브 동기화·AI 설명 · `sc_get_source`/`sc_list_requests` · `sc_propose_post` 의 contentId+photos · 웹 승인 썸네일·근거 · 노션 되쓰기 · 에밀리 스킬
- **P2 (텍스트 확장)**: 보도자료(문서 양식, 노션/구글 문서로 결과 전달), SNS 문구(인스타·스레드), 같은 날 요청 묶음 승인
- **P3 (시각물)**: 카드뉴스·영상 대본 → 이미지·영상 제작, 드라이브 사진 라이브러리 검색(소재에 사진 없는 글용)

## 9. 리스크·열린 문제

- 노션 API 파일 URL 은 1시간 만료 — 노션에 사진을 두지 않는 정책(미디어는 드라이브)으로 회피. 노션 본문에 사진이 있으면 경고만.
- AI 정규화 오류 → evidence substring 검증 + 승인 화면 근거 표시.
- 노션 상태 동시 편집 → 선점 시 현재 상태 재확인(낙관적), 사람은 작성 요청/취소만.
- Vercel 함수 시간 → 미디어 설명은 배치(호출당 N장) + cron drain.
- HEIC → 썸네일(JPEG) 로 설명, 게시용은 `=s2048` 썸네일.
- 노션 공개 OAuth(다른 고객사용)는 P2 이후.

## 10. Codex 리뷰 반영 (2026-11-08) — 위 본문보다 우선

| 등급 | 지적 | 반영 |
|---|---|---|
| P0 | WIF principal 이 SA 생성+impersonate 를 같이 가져 런타임 침해·SA 오선택 시 타 Space 드라이브 접근 | 런타임은 **서버가 DB 에서 조회한 `spaceId → SA` 매핑만** 사용(입력으로 SA/폴더 ID 를 받지 않음). WIF 조건에 `owner == eddysangwon-gmailcoms-projects` 추가. SA 이름에 환경 접두(`wd-p-`/`wd-d-`), 생성 시 해당 환경 매핑만 허용. TokenCreator 는 프로젝트 전체 대신 **생성한 SA 단위로 부여**(생성 직후 setIamPolicy). |
| P1 | 노션 상태 변경은 원자적 claim 아님 | **`ScPublishRequest`** 테이블: `@@unique([spaceId, notionPageId])`, 요청 필드 snapshot(유형·관점·희망일·소재 id·revision=last_edited_time), `state`, `leaseUntil`, `attempts`, `lastError`. claim 은 DB upsert+lease. 노션 상태는 DB 상태의 **projection**(매 cron 이 DB 상태를 노션에 덮어씀 — 멱등, outbox 불필요) |
| P1 | 기존 승인 액션은 승인 시 Content 신규 생성 → 선생성 Content 와 충돌 | 수신 시점엔 Content 를 만들지 않음(요청은 ScPublishRequest 에만). 에밀리 제안 `sc_propose_post({requestId,…})` → 승인 시 기존 경로가 Content+Deployment 생성하고 같은 트랜잭션에서 `ScPublishRequest.contentId` 연결(이미 연결돼 있으면 409, action id 유일). `targetUrl` 은 요청에 없으면 채널 기본 링크 정책 사용 |
| P1 | 승인한 사진 ≠ 게시 사진(승인 후 드라이브 변경·허용 철회) | **제안 시점에** 선택 사진을 storage 로 복사(md5 기록)하고 승인 화면은 그 복사본을 표시. 승인 시 그 asset 으로 `saveAssetPlan` 완료 — 승인 후 드라이브 변경 무관. 복사는 (requestId, mediaId, md5) 멱등 |
| P1 | 취소·수정·되쓰기 경합 | 취소는 DB state 가 `PUBLISHING` 이전일 때만 반영, 이후엔 노션에 「확인 필요」 projection. 요청 snapshot revision 저장, 작성 요청 후 노션 필드 변경은 무시(새 요청으로 안내) |
| P1 | Aside 리허설·불확실 결과 매핑 누락 | 노션 상태 매핑: 작성 요청 → 작성 중 → 승인 대기 → 사진 대기(AWAITING_ASSETS) → 예약/게시 중 → **임시저장 확인 필요**(리허설 AWAITING_MANUAL) / **확인 필요**(NEEDS_REVIEW·실패) → 게시 완료(URL 확인 후만) / 취소 |
| P1 | 테넌트·자격증명 | `ScNotionConnection { spaceId @unique, sourceDbId, requestDbId }`, `ScDriveConnection` 에 허용 shared drive/폴더 root. 모든 MCP/API 에서 source/version/media/request/channel 의 spaceId 일치 + 미디어가 소재 폴더(허용 root) 하위인지 검증. 노션 토큰은 기존 SpaceCredential 암호화, 등록·교체·해제는 ADMIN |
| P1 | 얼굴·근거 fail-open | `faceStatus: UNKNOWN/NO_FACE/FACE`, 기본 허용은 NO_FACE 만. 수동 허용은 userId·시각·md5 기록(파일 바뀌면 무효). evidence 는 블록 id+위치 보존, 생성 본문의 사실 일치는 승인 화면 사람 검토 |
| P1 | 부분 실패·중복 | 단계(가져오기·정규화·미디어·작성 대기)를 ScPublishRequest.state 로 진행, lease 만료 시 재선점, attempts/backoff, 최종 FAILED → Slack. sourceVersion `@@unique([sourceId, contentHash])` |
| P1 | `VERCEL_OIDC_TOKEN` env 는 빌드/로컬용 | 함수 런타임은 `@vercel/oidc`(`getVercelOidcToken()`) 로 요청 컨텍스트 토큰 사용. cron·MCP 진입 모두 검증 |
| P2 | Vercel 시간·크기 | Drive 목록 pageToken 커서 저장, 호출당 시간 예산(예: 240s) 체크포인트. 사진 복사는 서버→storage 스트림(함수 응답 4.5MB 무관), 원본 대신 `=s2048` |
| P2 | 이력 | 요청 snapshot·처리 오류는 ScPublishRequest, Content.sourceVersionId FK(불변), ScMedia md5 변경 시 허용 재판정 |

### 수정된 P1 모델 요약
`ScNotionConnection`, `ScDriveConnection`, `ScSource`, `ScSourceVersion`, `ScMedia`, `ScPublishRequest`, `Content.sourceVersionId?`
