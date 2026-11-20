# 설정 화면 초보자 개선 — 2단계 (외부 서비스 연결 그리드)

- 날짜: 2026-11-20
- 브랜치: `feat/settings-integrations-grid` (origin/develop `16e94834` 기준)
- 앞 단계: 1단계 `docs/plans/2026-11-20-settings-beginner-ux.md`(main #1542), 로고 #1547
- 와이어프레임(승인됨): `docs/design/plans/settings-beginner-ux/` integrations-grid·integrations-dialog·mobile, 번호 ④~⑪·⑱⑲

## 목표

`/settings/integrations`를 서비스 타일 그리드로 바꾼다. 서비스마다 공식 로고·한 줄 설명·연결 상태·버튼을 보여 주고, 상세와 입력은 팝업에서 한다. API·MCP·비밀값까지 같은 타일 UI로 맞춘다. develop에만 있는 연동 탭 3개(`integrations-tabs.tsx`, cf8cb062)를 대체한다.

**DB·스키마·쓰기 API 변경 없음.** 상태는 페이지 서버 컴포넌트에서 읽고(새 API 라우트 없음), 저장은 기존 카드와 기존 API를 그대로 쓴다.

## 서비스 목록과 상태 출처

| 그룹        | id                 | 이름                   | 상태(서버에서 읽음)                                                                                     | 버튼                                                                      |
| ----------- | ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 판매 채널   | `coupang-api`      | 쿠팡 Open API          | `CoupangApiCredential.isActive`(`resolveSpaceCoupangWorkspaceId`), 확인 필요=기존 쿠팡 테스트 실패 판정 | 팝업: `CoupangApiCard`                                                    |
| 판매 채널   | `coupang-login`    | 쿠팡 로그인            | `CoupangCredential.isActive`(같은 workspace)                                                            | 업무 설정 → 쿠팡 광고 설정. `coupang-ads` 업무가 켜져 있을 때만 타일 표시 |
| 판매 채널   | `naver-nbaesong`   | 네이버 N배송           | `SpaceCredential(provider='naver-commerce')` 존재                                                       | 업무 설정 → 브랜드 운영 데이터 연동. `seller-hub` 켜져 있을 때만          |
| 광고·마케팅 | `meta-ads`         | Meta 광고              | `SpaceCredential('meta-ads')` 존재, `healthError`가 있으면 확인 필요                                    | 3단계 전까지 연결됨이면 상태만, 아니면 "준비 중"(비활성 버튼 + 설명)      |
| 광고·마케팅 | `google-marketing` | Google 마케팅          | `SpaceCredential('google-marketing')`                                                                   | 위와 같음                                                                 |
| 광고·마케팅 | `naver-searchad`   | 네이버 검색광고        | `SpaceCredential('naver-searchad')`                                                                     | 위와 같음                                                                 |
| 협업 도구   | `slack`            | Slack                  | `SlackInstallation` 존재(팀 이름)                                                                       | 팝업: `SlackConnectCard`                                                  |
| 협업 도구   | `notion`           | 노션                   | `ScNotionConnection` 존재, `lastError`면 확인 필요                                                      | 팝업: `OsmuConnections` 노션 부분. `sales-content` 켜져 있을 때만         |
| 협업 도구   | `google-drive`     | 구글 드라이브          | `ScDriveConnection` 존재(+`rootId`), `lastError`면 확인 필요                                            | 팝업: `OsmuConnections` 드라이브 부분. `sales-content` 켜져 있을 때만     |
| AI·에이전트 | `workdeck-agent`   | 워크덱 에이전트        | `SpaceAgentSetting.isActive ?? true`(API 기본값과 같음)                                                 | 팝업: `AgentToggleCard`                                                   |
| AI·에이전트 | `my-ai-app`        | 내 AI 앱 연결          | 상태 없음(연결 목록은 브라우저 Supabase 세션에서만 읽힘)                                                | 팝업: `McpGuideCard` + 계정 설정 '연결된 AI 앱' 링크. **MEMBER도 사용**   |
| AI·에이전트 | `agent-tokens`     | 에이전트 접속 토큰     | ACTIVE `SpaceAgent` 수, 확인 필요=기존 토큰 만료 판정                                                   | 팝업: `AgentTokensCard`                                                   |
| 기타        | `secrets`          | 직접 등록한 API·로그인 | `SpaceSecret` 수, 확인 필요=기존 비밀값 만료 판정                                                       | 팝업: `SpaceSecretsCard`                                                  |

- 로고: `public/brand/`(Wikimedia Commons, 원 출처 각 사, README 출처표 갱신). 쿠팡·네이버·Meta·Google·노션·드라이브·Slack. 워크덱 에이전트는 워크덱 아이콘, 내 AI 앱·토큰·비밀값은 lucide 아이콘(`Bot`·`KeyRound`·`LockKeyhole`). 공식 파일을 못 구하면 이름 첫 글자 원형 자리표시를 쓰고 보고한다(흉내 그림 금지)
- 상태 값: `connected` / `not_connected` / `attention`(+짧은 요약). 비밀값 자체·키 일부·채널 ID는 상태에 담지 않는다

## 변경 파일

1. `src/lib/integrations/catalog.ts`(신규): 위 표의 정적 목록(id·그룹·이름·설명·로고·버튼 종류·필요 업무·키 발급 단계/공식 링크).
2. `src/lib/integrations/load-status.ts`(신규, `server-only`): `loadIntegrationStatuses(spaceId, userId, { includeAttentionDetail })`. 한 쿼리가 실패해도 그 타일만 `unknown`으로 두고 페이지는 연다(기존 `orFallback` 재사용). 확인 필요 판정은 기존 `buildAttention` 결과를 재사용한다. **MEMBER에게는 상태와 개수만**, 확인 필요 문구(에이전트·비밀값 이름 포함)는 ADMIN 이상에게만 넘긴다.
3. `app/settings/integrations/page.tsx`: 역할과 상관없이 상태를 읽고 `IntegrationsGrid`에 넘긴다. 기존 `searchParams`(`slack`, `tab`)를 읽어 초기 팝업으로 변환한다.
4. `src/components/integrations/integrations-grid.tsx`(신규, client):
   - 맨 위 요약: 연결됨 N · 연결 필요 M · 확인 필요 K. K>0이면 항목 목록과 [확인] 버튼(그 팝업 열기)
   - 그룹 제목 + 타일 그리드(`sm:grid-cols-2 lg:grid-cols-3`). 모바일은 한 줄 행, 행 전체가 버튼
   - 팝업 열림은 URL이 기준: `?open=<id>`(허용 id만, 기존 query 보존, `router.replace`). 닫으면 `open` 제거 + `router.refresh()`로 상태 다시 읽기
   - 옛 링크 호환: `?tab=agents`→`agent-tokens`, `?tab=secrets`→`secrets`, `?tab=services`→팝업 없음, `?slack=<결과>`→`slack` 팝업
   - MEMBER: 버튼 자리에 "관리자에게 요청"(텍스트), `my-ai-app`만 열림. ADMIN 전용 카드는 렌더하지 않는다(API도 호출 안 함)
5. `src/components/integrations/integration-dialog.tsx`(신규): `Dialog` 머리(로고·이름·연결하면 되는 일 한 줄) → 키 발급 방법 `<details>`(단계 + 공식 링크 `rel="noopener noreferrer"`) → 본문(기존 카드). 모바일은 전체 높이 시트(`max-sm:h-dvh`), 본문 스크롤.
6. 기존 카드에 `embedded?: boolean` 추가(`slack-connect-card`, `coupang-api-card`, `agent-toggle-card`, `agent-tokens-card`, `space-secrets-card`, `mcp-guide-card`): 참이면 `CardHeader`를 숨기고 `Card`를 테두리·그림자·패딩 없이 렌더(팝업 안 카드 중첩 방지). 로직·API 호출은 그대로.
7. `src/components/sc/settings/osmu-connections.tsx`: `only?: 'notion' | 'drive'`, `embedded?` 추가. 지정 시 그 카드만 렌더. 세일즈 콘텐츠 설정 화면은 지금처럼 둘 다.
8. 삭제: `src/components/integrations/integrations-tabs.tsx`와 테스트(그리드가 대체). `src/lib/integrations/attention.ts`의 `tab` 필드는 그리드 id로 바꾼다(`cardId` → 서비스 id).
9. 다른 화면 링크: `coupang-source-card.tsx`·`deck-slack-notify-card.tsx`의 `?tab=services` → `?open=coupang-api` / `?open=slack`. `location-manager.tsx` 문구 "외부 서비스 연결 → 비밀값" → "외부 서비스 연결 → 직접 등록한 API·로그인"(링크 `?open=secrets`).
10. `public/brand/` 로고 추가 + `README.md` 출처표 갱신.

## 테스트

- `src/lib/integrations/__tests__/load-status.test.ts`: 각 출처별 connected/not_connected/attention, 한 쿼리 실패 시 그 타일만 unknown, MEMBER 옵션에서 확인 필요 문구 제외
- `src/components/integrations/__tests__/integrations-grid.test.tsx`: 그룹·타일 렌더, 업무 꺼진 경우 업무 전용 타일 숨김, `?open=` 초기 팝업·잘못된 값 무시·query 보존, 옛 `?tab=secrets`·`?slack=` 호환, 닫으면 `router.refresh`, MEMBER는 버튼 대신 안내·`my-ai-app`만 열림, "준비 중" 타일 비활성
- `app/settings/integrations/__tests__/page.test.tsx` 갱신, 삭제되는 `integrations-tabs.test.tsx` 제거
- 기존 카드 테스트가 있으면 `embedded` 기본값(false)에서 그대로 통과

## 검증

- `npm test -- <changed> --runInBand`, `npm run typecheck`, `npx eslint <changed>`, `npm run build`
- 로컬 dev(관리자·소유자 QA 계정, dev DB): 데스크톱·390px 그리드와 팝업 3종(쿠팡 API·Slack·비밀값) 캡처, 팝업에서 저장 없이 열고 닫기, axe serious·critical 0
- MEMBER 화면은 테스트로 보장(dev에 MEMBER 계정이 없으면 보고에 적음)

## 위험과 롤백

- 기존 카드를 팝업으로 옮기며 입력 중 값이나 한 번만 보이는 토큰이 사라질 위험 → 팝업 본문 상시 마운트(검토 반영 2)
- 상시 마운트로 페이지 진입 시 카드 GET이 한꺼번에 나감 → 지금 탭 화면(forceMount)과 같은 수준이라 수용
- 상태 쿼리 증가로 페이지가 느려질 위험 → 모두 `findUnique`/`count`, `Promise.all` 병렬
- 롤백: DB 변경이 없어 PR revert로 되돌린다

## 범위 밖

- Meta·Google·네이버 검색광고 입력 팝업(3단계)
- 쿠팡 로그인·N배송 입력을 이 화면으로 옮기기(업무 설정 링크 유지)

## 검토 반영

Codex adversarial-review(2026-11-20) 지적 4건 — 반영 4, 보류 0.

1. [high] MEMBER에게 관리자 전용 자산(에이전트·비밀값) 존재·만료 노출, 쿠팡 workspace 해석이 요청자 workspace로 fallback → **MEMBER 정책 확정**:
   - 서버는 MEMBER일 때 관리자 전용 출처(에이전트 토큰·비밀값·쿠팡 2종·확인 필요 판정)를 **조회하지 않는다**. 해당 타일은 MEMBER 화면에서 숨긴다(토큰·비밀값) 또는 상태 없이 "관리자가 관리합니다"로 둔다(쿠팡 2종)
   - MEMBER에게는 Space 단위 출처의 연결 여부(boolean)만: Slack·Meta·Google·네이버 검색광고·N배송·노션·드라이브·워크덱 에이전트 켜짐. 확인 필요·오류 문구·개수 없음
   - `loadIntegrationStatuses`는 `role`을 받아 분기하고, 테스트로 MEMBER 호출 시 관리자 전용 prisma 쿼리가 불리지 않음을 고정한다
2. [high] 팝업 닫힘으로 일회용 토큰 유실 → 팝업 본문을 **계속 마운트**(`DialogContent forceMount` + 닫힘 시 숨김, 지금 탭 화면의 forceMount와 같은 방식). 바깥 팝업을 닫거나 `?open`이 바뀌어도 카드 state와 카드 안의 발급 결과 Dialog가 유지된다. 발급 결과 Dialog 자체를 닫으면 사라지는 동작은 지금과 같다(변경 없음). 위 "바깥 클릭 차단" 안은 버린다. 테스트: 토큰 발급 결과 표시 중 `?open` 제거 → 결과 Dialog와 토큰 값이 남아 있음
3. [high] 옛 query 보존 시 닫은 팝업 재개방 → **옛 파라미터는 1회 소비**: 서버 페이지가 `tab`·`slack`을 읽어 `initialOpen`·`slackStatus`로 넘기고, 클라이언트는 마운트 직후 `router.replace`로 `tab`·`slack`을 지우고 `open=<id>`만 남긴다(다른 query 보존). 닫으면 `open`만 지운다. 이후 refresh·재방문은 `open` 기준만 본다. 테스트: `?slack=success&foo=1` → 마운트 후 `?foo=1&open=slack`, 닫기 → `?foo=1`, 다시 렌더해도 열리지 않음
4. [medium] 노션·드라이브 타일이 업무 활성만 보고 API 가드(구독 402·권한 403)와 어긋남 → 타일 노출은 `sales-content` 활성 기준을 유지하되, `OsmuConnections`가 GET 실패와 저장 실패(402·403 포함)의 서버 메시지를 팝업 안에 `text-destructive`로 보여 주도록 고친다. 테스트: GET 403·PUT 402 응답 시 문구 표시

## 코드 리뷰 반영 (opus, 2026-11-20)

지적 7건 — 반영 6, 보류 1.

- [critical] 팝업 본문(portal) 클릭이 바깥 클릭으로 처리될 수 있음 → 실제 브라우저·jsdom 모두 재현 안 됨. 그래도 `onPointerDownOutside`·`onInteractOutside`에서 host 안 대상이면 닫지 않게 방어 추가 + 회귀 테스트
- [high] 옛 query 소비 후 Slack OAuth 결과가 사라짐 → 그리드가 처음 `slackStatus`를 고정
- [medium] MEMBER에게 Slack 팀 이름 전달 → MEMBER는 요약 없이 연결 여부만
- [medium] 검토 반영 2·3 테스트 보강 → 닫은 뒤 재렌더해도 안 열림, OAuth 결과 유지 테스트 추가. 중첩 Dialog 유지는 실제 브라우저에서 확인(비밀값 등록 팝업)
- [low] 드라이브 계정만 있어도 연결됨 → `rootId` 기준
- [low] 업무 변경 시 host 재생성으로 카드 state 유실 → 기존 host 재사용
- [low·보류] 노션·드라이브가 `OsmuConnections`를 따로 마운트해 한쪽 저장 후 다른 쪽이 새로고침 전까지 예전 상태 → 두 팝업을 연달아 쓰는 경우가 드물고 페이지 refresh(팝업 닫기)로 다시 읽혀 보류
