# 카페24 다중 자사몰 연결 — 실행 계획 (2026-11-21)

## 목표

한 작업 공간(Space)에서 카페24 쇼핑몰(쇼핑몰 ID가 다른 별도 계정) 여러 개(최대 5)를 연결하고, 판매채널마다 어느 쇼핑몰 주문을 관측할지 고른다. 앱(client_id/secret)은 「Workdeck 주문 연동」 하나를 공유한다(개발중 앱 설치 한도 5몰, 사용자 확인).

## 카페24 문서 확인 (2026-11-21, 개발자센터 직접 확인)

- 인증 코드 요청·토큰 발급·재발급 모두 `https://{mall_id}.cafe24api.com/api/v2/oauth/...` — 쇼핑몰마다 따로 승인·토큰, 같은 client_id/secret 사용(현재 구현과 동일). 토큰 응답에 `mall_id` 포함 → 콜백의 mall_mismatch 검사 그대로 유효.
- 개발중(심사 전) 앱은 최대 5개 쇼핑몰에 설치 가능. 공식 테스트 경로는 개발자 어드민 「테스트 실행」에 쇼핑몰 ID 입력 → 그 몰 관리자 로그인 → 설치 동의. 우리 install 은 같은 authorize 주소로 바로 보내는 방식(ameaning24 에서 동작 확인). **다른 계정 몰에서 직접 authorize 가 되는지는 두 번째 몰 실승인으로 확인**하고, 안 되면 「테스트 실행」으로 먼저 설치하도록 팝업 안내 문구만 바꾼다(코드 변경 없음).
- 승인은 **대표 운영자 계정**으로 해야 함(부운영자면 `access_denied` → 현재 `denied` 결과). 팝업 안내 문구에 넣는다.
- 액세스 토큰 2시간, 리프레시 14일·1회용(회전), 토큰 요청 2시간 최대 15회(초과 시 클라이언트 일시 차단) — 쇼핑몰마다 30분 관측이 2시간에 1번 갱신하므로 5몰이어도 한도 안. 갱신은 몰별 lease 로 몰마다 1건만.
- 주의 문구: 테스트 몰은 운영하지 않는 몰이어야(운영 몰 장애는 카페24 미중재) — 사용자 고지 완료. 앱 삭제 시 해당 몰 토큰 폐기 → 우리 쪽은 `reauth_required` 로 표시됨.

## 저장 방식 결정

- **쇼핑몰별 자기완결 행**: 새 쇼핑몰은 `SpaceCredential.provider = 'cafe24:<mallId>'`, secret `{clientId, clientSecret, accessToken?, refreshToken?}`, config 는 지금과 동일(`mallId, credVersion, status, refreshLease, …`).
- **기존 `cafe24` 행은 옮기지 않는다(마이그레이션 없음).** 새 코드는 provider `cafe24`(레거시, config.mallId 로 식별) 와 `cafe24:<mallId>` 를 모두 "쇼핑몰 행"으로 읽는다. `readCafe24(spaceId, mallId)` = `cafe24:<mallId>` 행, 없으면 레거시 행의 config.mallId 가 같을 때 그 행. 모든 쓰기는 **읽은 행의 provider·id** 로 조건부 쓰기. 같은 mallId 로 새 행을 만들지 않는다(등록 시 레거시 포함 중복 검사).
- 레거시 행도 목록(`listCafe24`)·연동 타일(`load-status`)·health 조회(provider = `cafe24` 또는 startsWith `cafe24:`)에 포함하고, health 는 행의 config.mallId 로 같은 probe 에 디스패치한다. 레거시만 있는 상태의 목록·타일·health 테스트 필수.
- 쇼핑몰 추가·앱 정보 수정·삭제는 같은 트랜잭션 안에서 `pg_advisory_xact_lock(hashtext('cafe24:' || spaceId))` 로 Space 단위 직렬화(추가가 옛 앱 정보를 복사하는 사이 전파가 끝나 갈라지는 경합 차단). 갱신(refresh)은 이 잠금을 쓰지 않는다(외부 HTTP 동안 잠금 금지 원칙 유지).
- 앱 정보는 각 행에 복사해 둔다. 사용자는 1회만 입력: 쇼핑몰 추가 시 secret 을 비우면 서버가 기존 쇼핑몰 행의 앱 정보를 복사한다. 앱 정보 수정은 **한 DB 트랜잭션** 안에서 모든 쇼핑몰 행을 credVersion 조건부 updateMany 로 갱신하고, 한 행이라도 0행이면 throw → 전부 롤백 → 409(다시 시도). clientId 가 바뀌면 각 행 토큰·lease 폐기 → `needs_auth`. 진행 중이던 갱신은 저장 단계에서 clientId 변경을 보고 결과를 버린다(기존 `refreshHoldingLease` 의 재읽기 규칙 그대로).
- 이유: 갱신·lease·credVersion 로직(Codex 3차 검토 완료)이 행 1개 단위 그대로 유지된다. 운영 데이터 변경이 없어 배포 경합(구버전이 이름 바뀐 행을 못 찾음·재생성)과 롤백 충돌이 생기지 않는다 — 구버전은 `cafe24:*` 행을 무시하고 레거시 행으로 그대로 동작한다.
- 기각: (a) provider 이름 변경 마이그레이션 — 배포 중 구버전 쓰기 유실·롤백 시 @@unique 충돌(Codex 1차 지적). (b) 앱 행 + 토큰 행 분리 — 레거시 행 분할에 복호화·재암호화 이전 필요, 갱신 시 두 행 읽기. (c) 한 행에 malls 맵(naver-commerce 방식) — 쇼핑몰 간 갱신이 같은 credVersion 을 다퉈 재시도 실패 위험.

## 변경 파일

1. `src/lib/cafe24/store.ts` — `cafe24Provider(mallId)`, `parseCafe24Provider(p)`(MALL_ID_RE 검증). `readCafe24(spaceId, mallId)`, `writeCafe24If` 의 where.provider 를 **행의 provider** 로, `createCafe24(spaceId, mallId, …)`, `listCafe24(spaceId)`(provider startsWith `cafe24:`, 복호화 없이 config 만), `registerCafe24(spaceId, {mallId, clientId?, clientSecret?})`: 해당 몰 생성/수정 + 앱 정보가 바뀌면 다른 몰 행에도 전파. 5개 초과면 `limit`. `deleteCafe24(spaceId, mallId)`.
2. `src/lib/cafe24/client.ts` — `getAccessToken/refreshHoldingLease/releaseLease/markReauthRequired/cafe24Get/probeOrders` 에 `mallId` 인자. 로직 변경 없음.
3. `app/api/integrations/cafe24/install/route.ts` — form 에 `mallId`(MALL_ID_RE), 해당 몰 행으로 state 생성.
4. `app/api/integrations/cafe24/callback/route.ts` — `state.mallId` 로 행 읽기·쓰기, `probeOrders(spaceId, mallId)`. 결과 쿼리에 `mall=<mallId>` 추가(카드가 어느 몰 결과인지 표시).
5. `app/api/integrations/cafe24/status/route.ts` — `{ malls: [{mallId,status,connectedAt,scopes,error}], appConfigured }`.
6. `app/api/spaces/[spaceId]/credentials/[provider]/route.ts` — PUT `cafe24`: `config.mallId` 필수, `secret` 선택(첫 몰이면 필수 → 400). 응답 409(동시 수정)/400(한도·앱 정보 없음). **DELETE** `?mallId=`(ADMIN+aal2, cafe24 만): 그 몰 행 삭제. 관측이 켜진 채널이 그 몰을 쓰면 409.
7. `src/lib/integrations/load-status.ts` — cafe24 를 `startsWith 'cafe24:'` 로 조회, 타일 집계: 하나라도 reauth/healthError → 확인 필요, 하나라도 connected → 연결됨(요약 "쇼핑몰 N개").
8. `src/lib/agent/integrations/credential-health.ts` — 조회 where 를 `OR [{provider in PROBES keys}, {provider startsWith 'cafe24:'}]`, 디스패치는 prefix, probe 에 mallId 전달, 라벨 `카페24(<mallId>)`.
9. `app/api/channels/[channelId]/order-observe/route.ts` + `src/lib/channel-orders/types.ts` — cafe24 도 `storeKey`(=mallId) 저장, 켤 때 필수 + 그 몰 행 존재 확인. 중복 제한을 "쇼핑몰당 관측 채널 1개"(spaceId+adapter+storeKey)로.
10. `src/lib/channel-orders/adapters/cafe24.ts` — `fetchWindow(spaceId, mallId, …)`, started.storeKey 사용. storeKey 가 null(이 배포 전 설정)이면 레거시 `cafe24` 행을 쓴다(호환). 레거시 행이 없으면 not_configured. 삭제·몰당 1채널 가드에서도 null storeKey 는 레거시 행의 mallId 로 해석한다. 레거시 행을 삭제한 뒤 같은 ID 를 다시 추가하면 `cafe24:<mallId>` 행이 되고, null storeKey 채널은 쇼핑몰을 다시 골라야 한다(삭제 가드가 관측 켜진 채널이 있으면 삭제를 막으므로 꺼진 채널만 해당).
    관측 대상 변경 경합: `startObserve`·`startFullScan` 의 lease 획득 UPDATE 조건에 `adapter = 읽은 값 AND "storeKey" IS NOT DISTINCT FROM 읽은 값` 을 추가(읽은 뒤 설정이 바뀌면 lease 실패 → 다음 회차). 또 order-observe PUT 이 adapter·storeKey 를 바꿀 때(reset) 커서와 함께 **observeLease 도 비우고**, 그 채널의 RUNNING `PipelineOperation` 을 FAILED(`setting_changed`)로 닫는다 → 진행 중 작업의 ingest·finish 는 lease_lost/유효하지 않은 operation 으로 거부된다(ingest 는 같은 트랜잭션에서 lease 확인 — `ingest.ts`). 경합 테스트 추가.
11. UI — `src/components/integrations/cafe24-connect-card.tsx`: 쇼핑몰 목록(ID·상태·승인일·다시 승인/승인·삭제) + 「쇼핑몰 추가」(쇼핑몰 ID 입력, 첫 몰은 앱 정보도) + 「앱 정보 수정」. `src/components/sh/channels/channel-order-observe-section.tsx`: 카페24 선택 시 연결된 쇼핑몰 Select(GET status 재사용 불가 — ADMIN 전용이라 이 섹션도 ADMIN 만 보이므로 그대로 사용). 와이어프레임 합의 후 구현.
12. 마이그레이션 없음(스키마·데이터 변경 없음).
13. 테스트 — 기존 `__tests__`(store/client/install/callback/status/health/credentials route/load-status/observe route/adapter) 시그니처·provider 갱신 + 신규: 레거시 행 읽기·쓰기(provider 유지), 같은 mallId 중복 생성 거부, 몰 2개 독립 갱신(서로 lease 안 막음), 앱 정보 전파 중간 행 충돌 시 전체 롤백, 한도 5, 삭제 가드, health prefix 디스패치, observe storeKey 필수·몰당 1채널·몰 변경 시 lease 무효화.

## 단계

1. 계획 검토(Codex adversarial) → 반영.
2. UI 와이어프레임(연동 팝업 쇼핑몰 목록, 관측 쇼핑몰 선택) 에디 합의.
3. 구현(서버 → UI) sonnet 서브에이전트, 주 세션이 diff·테스트 재검증.
4. `tsc`·관련 jest·lint·build → opus 코드리뷰 → develop PR → 격리 main PR.

## 검증

- jest 위 목록 + 신규 테스트, `npx tsc --noEmit`, `npm run build`.
- 로컬 dev(일회용 ENCRYPTION_KEY_V1·SLACK_SIGNING_SECRET): 몰 2개 추가·목록·install 주소의 mall 호스트 확인(cafe24api.com 은 route abort), 삭제, 관측 쇼핑몰 Select. dev DB 에 레거시 `cafe24` 행이 있는 상태로 목록·다시 승인 주소·두 번째 몰 추가 확인.
- 운영(배포 후): 연동 팝업에 ameaning24 「연결됨」 유지, 다음 날 08:00 KST health 성공(healthError 없음), 두 번째 몰 추가·승인은 에디가 진행.

## 위험·대응

- 배포 경합 없음(데이터 변경 없음). 레거시 행은 계속 같은 provider 로 갱신된다.
- **몰별 관측 중복 제한·삭제 가드의 동시 요청 경합(Codex 5번, 보류)**: 조회 후 upsert 라 두 관리자가 동시에 같은 몰을 두 채널에 켜거나, 켜기와 몰 삭제가 교차하면 막지 못한다. 관리자 전용·드문 설정 작업이고, 부분 unique 인덱스는 Prisma 스키마로 표현되지 않아 migrate dev 드리프트 위험이 있어 넣지 않는다. 삭제된 몰을 참조하는 채널은 관측이 auth_error 로 실패 기록되어 보인다. `ponytail:` 주석으로 한계 명시.
- nonce 쿠키 1개 → 두 몰 승인을 동시에 시작하면 먼저 시작한 쪽이 `expired`. 다시 승인으로 해결, 수정하지 않음.
- 운영 몰 사용은 카페24 공식 권장 아님(사용자 고지 완료). 5몰 초과는 앱 심사 필요 — 서버 한도 5(레거시 포함).

## 롤백

- **revert 전 필수**: 레거시 몰이 아닌 쇼핑몰(storeKey ≠ 레거시 mallId)로 관측이 켜진 채널의 관측을 끈다(구버전 어댑터는 storeKey 를 무시하고 레거시 몰 주문을 그 채널에 적재하므로). 확인: 판매채널 주문정보 탭. 그 다음 코드 revert.
- 코드 revert 만. 구버전은 레거시 `cafe24` 행으로 동작하고 `cafe24:*` 행·cafe24 storeKey 는 무시한다(데이터 보존 — 다시 배포하면 그대로 복귀). 추가 몰의 관측은 롤백 동안 멈춘다.

## Codex 검토 반영 (1차, 5건)

- 1 [high] 이름 변경 중 구버전 쓰기 유실 → 반영: 마이그레이션 제거, 레거시 행 호환 읽기.
- 2 [high] 앱 정보 전파 원자성 → 반영: 한 트랜잭션·한 행이라도 충돌이면 전체 롤백.
- 3 [high] 관측 중 몰 변경 시 커서 덮어쓰기 → 반영: reset 시 lease 비우기 + RUNNING operation 종료.
- 4 [high] 롤백 SQL 충돌 → 반영: 마이그레이션이 없어 코드 revert 만으로 롤백.
- 5 [medium] 몰당 1채널·삭제 가드 동시성 → 보류(위 위험 항목에 이유).

## Codex 검토 반영 (2차, 5건)

- 1 [high] 롤백 시 추가 몰 채널이 레거시 몰 주문 수집 → 반영: 롤백 절차에 revert 전 관측 끄기.
- 2 [high] 설정 읽기~lease 획득 사이 몰 변경 → 반영: lease UPDATE 조건에 adapter·storeKey 일치.
- 3 [high] 레거시 삭제·재등록 시 null storeKey → 반영: 가드에서 null=레거시 mallId, 재등록 후 쇼핑몰 재선택 명시.
- 4 [high] 몰 추가와 앱 정보 전파 교차 → 반영: Space 단위 advisory 트랜잭션 잠금.
- 5 [medium] 목록·타일·health 레거시 누락 → 반영: 세 경로 레거시 포함 명시 + 테스트.

## 구현 후 코드리뷰(opus) 반영

- 반영: 레거시 null 채널을 같은 몰로 다시 저장 시 reset 안 함(테스트 추가), FULL_SCAN 시작 직후 설정 재확인(바뀌었으면 setting_changed), 앱 교체 시 healthError 도 비움, 빈 storeKey→null, 관측 탭 쇼핑몰 목록 조회 실패 구분, 복귀 알림의 `?mall=` 은 연결된 몰일 때만 표시.
- 한계(기존 동작): 관측 몰을 A→B 로 바꾸면 커서만 초기화되고 A 에서 관측한 주문 행은 그 채널에 남는다(네이버 storeKey 변경도 동일). 대사 오탐이 보이면 정리 로직 추가.
- 로컬 QA(dev): 빈 상태 → 첫 몰(앱 정보 포함) 추가 → 두 번째 몰 ID만 추가(앱 정보 복사) → install 주소 `qashop-b.cafe24api.com/api/v2/oauth/authorize`·client_id 복사 확인 → 관측 탭 쇼핑몰 Select 옵션 확인 → DELETE 200/재삭제 404. 더미 행 정리 완료.

## 후속(11-21 저녁): 쇼핑몰별 앱 정보 — 운영 실패 원인 반영

- 운영에서 kreamd(다른 카페24 계정) 승인 → 토큰 교환 `invalid_client`(401). 카페24 FAQ: "앱 테스트를 위해서 반드시 개발자센터 계정이 소유한 쇼핑몰 아이디" — 심사 전 앱은 만든 계정 소유 몰에서만 토큰 발급. 처음 계획의 "앱 하나 공유" 가정이 틀림.
- 결정(에디): 몰마다 그 계정 개발자센터에서 같은 설정의 앱을 만들고, 그 앱 정보를 그 몰 행에만 저장한다(행이 이미 자기완결이라 저장 구조 변경 없음).
- 변경:
  1. `registerCafe24`: 앱 정보 전파를 없앤다. `{mallId, clientId?, clientSecret?}` → 그 몰 행만 생성/수정(clientId 가 바뀌면 그 행 토큰·lease·오류 비우고 needs_auth, secret 만 바뀌면 토큰 유지). 새 몰에 앱 정보가 없으면 기존 몰 행의 앱 정보를 복사(같은 계정 몰용, 첫 몰이면 app_required). mallId 없는 PUT(전체 앱 정보 수정)은 400.
  2. 잠금 트랜잭션·한도 5·같은 mallId 중복 금지는 유지.
  3. UI: 전역 「앱 정보 수정」 → 행별 「앱 정보」(그 몰의 client_id/secret 수정). 추가 폼은 앱 정보 입력을 항상 보여 주고 기존 몰이 있으면 선택 입력 + 안내 "다른 카페24 계정의 쇼핑몰이면 그 계정 개발자센터에서 만든 앱 정보를 입력하세요(비우면 기존 앱 정보 사용 — 같은 계정 몰만 가능)". 승인 실패(error) 안내에 같은 내용 한 줄.
  4. 테스트: 전파 테스트를 "그 몰만 바뀜"으로 교체, mallId 없는 PUT 400, 몰별 앱 교체 시 다른 몰 토큰 유지.
- 운영 데이터: kreamd 행은 그대로 두고 에디가 행별 「앱 정보」로 kreamd 앱 값을 넣은 뒤 다시 승인(clientId 변경 → needs_auth 초기화).
- 롤백: revert 시 구버전은 몰마다 다른 clientId 를 그대로 쓰므로(행 자기완결) 동작 유지, 단 구버전 「앱 정보 수정」이 전 몰에 전파하니 롤백 중엔 쓰지 않는다.
- Codex 검토(후속) 4건 — 반영 4: ①복사 출처 모호 → 복사 제거, 새 몰은 앱 정보 필수 ②시크릿 교체 중 갱신 → invalid_grant 판정의 "설정 바뀜"에 clientSecret 포함(테스트, 수정 없으면 실패 확인) ③롤백 → **롤백 기간엔 카페24 앱 정보 저장 금지**(구버전은 mallId+앱 정보 PUT 도 전 몰 전파) ④콜백 실패 기록은 앱 정보가 그대로일 때만.
