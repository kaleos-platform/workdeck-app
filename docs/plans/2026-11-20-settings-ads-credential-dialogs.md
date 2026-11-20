# 설정 화면 초보자 개선 — 3단계 (Meta·Google·네이버 검색광고 입력 팝업)

- 날짜: 2026-11-20
- 브랜치: `feat/settings-ads-credential-dialogs` (origin/develop `00c66b76`)
- 앞 단계: 2단계 그리드 `docs/plans/2026-11-20-settings-integrations-grid.md`(main #1551). 지금 세 타일은 "준비 중"
- UI 패턴: 2단계에서 승인된 연결 팝업(⑧ 설명 → ⑨ 키 발급 방법 → 입력 → ⑪ 저장 후 확인). 새 화면 구조가 아니라 같은 팝업 안에 폼을 넣는 작업이라 별도 와이어프레임 없이 진행

## 목표

API로만 등록하던 Meta 광고(`meta-ads`), Google 마케팅(`google-marketing`), 네이버 검색광고(`naver-searchad`) 자격증명을 외부 서비스 연결 팝업에서 등록·수정할 수 있게 한다. 저장은 기존 `PUT /api/spaces/[spaceId]/credentials/[provider]`(ADMIN + 2단계 인증 aal2, Meta·네이버는 저장 시 실제 계정 확인)를 그대로 쓴다.

## 변경

### A. 설정값 읽기 GET (같은 라우트)

`app/api/spaces/[spaceId]/credentials/[provider]/route.ts`에 `GET` 추가.

- 권한: `requireSpaceAdmin(spaceId)`(PUT과 같음). 대상 provider는 세 개만(`naver-commerce`는 기존 N배송 화면이 따로 읽으므로 제외). **2단계 인증은 요구하지 않는다** — 돌려주는 값은 광고 계정·속성 ID와 브랜드 이름뿐이고, 이는 관리자가 에이전트 설정·승인 화면에서 이미 보는 수준이다(결정 기록)
- 응답: `{ registered, config, lastVerifiedAt, hasError, pendingActions }`
  - `config`: provider별 허용 필드만 — meta `defaultBrand·adAccounts·accountCurrencies·graphVersion`, google `defaultBrand·brands`, naver `defaultBrand·managerCustomerId·customers`. 암호문·복호화 값 없음
  - 외부 오류 원문(`lastError`·`healthError`)은 돌려주지 않는다. `hasError: boolean`만 주고 화면은 "최근 연결 확인에 실패했습니다. 키를 다시 확인해 주세요"로 표시
  - `pendingActions`: 이 provider(`actionType` 접두 `meta-ads.`·`google-marketing.`)의 PENDING·APPROVED 제안 수(네이버는 쓰기 액션이 없어 0)
- `Cache-Control: no-store`

### B. 저장(PUT) — 비밀값은 매번 전부 입력 (병합 안 함)

처음 계획의 "비워 두면 기존 키 유지"는 **하지 않는다**(검토 반영 2). 지금 API처럼 저장할 때마다 키 전체를 받는다. 대신:

- Meta `graphVersion`: 요청에 없으면 서버가 기존 행의 `config.graphVersion`을 그대로 둔다(폼은 이 값을 보여 주기만 하고 편집하지 않음)
- 확인 호출을 거친 저장(Meta·네이버)이 성공하면 `healthError`를 함께 지운다. `healthAlertedAt`은 두어 다음 점검 성공 때 기존 복구 알림이 나가게 한다. Google은 저장 시 확인이 없으므로 점검 상태를 건드리지 않는다
- 그 밖의 PUT 동작·검증·응답은 그대로

### C. 팝업 폼 (클라이언트)

`src/components/integrations/ad-credential-form.tsx`(신규, 세 provider 공용):

- provider별 정의(같은 파일 안 상수): 비밀값 입력 칸, 공통 설정 칸(네이버 `managerCustomerId`), 브랜드 행의 칸(Meta: 광고 계정 ID / Google: GA4 속성 ID·GTM 계정 ID·GTM 컨테이너 ID / 네이버: 광고주 고객 ID), 입력 형식(숫자만, Meta는 `act_` 접두 허용)
- 화면 순서: 상태 줄(등록됨·마지막 확인 시각·확인 실패 여부) → 비밀값 칸(등록됨이어도 "보안을 위해 저장할 때마다 키를 다시 입력합니다" 안내, 칸은 비어 있음) → 브랜드 행 목록(브랜드 이름 + 칸들, [행 추가]·[삭제], 기본 브랜드 라디오. 행이 1개면 자동 기본) → [저장 후 연결 확인]
- 브랜드 이름은 에이전트가 계정을 고를 때 쓰는 이름이라는 설명을 한 줄 둔다. 이름 중복·빈 칸은 저장 전에 막는다
- 저장은 `fetchWithMfa` + `redirectIfMfaRequired`(기존 쿠팡 카드와 같은 방식). 실패 시 서버 메시지를 폼 안 `text-destructive`로 표시, 성공 시 토스트 + 입력한 비밀값 칸 비움 + `onChanged()`(그리드 refresh)
- Meta 저장 응답의 `accountCurrencies`를 계정 옆에 보여 준다(원화가 아니면 "예산 제안은 원화 계정만 가능" 안내)
- 브랜드 수 제한은 서버와 맞춘다(네이버 1~20)
- 이미 등록된 매핑(브랜드 이름·계정 ID)을 바꾸고 `pendingActions > 0`이면 저장 전에 경고: "승인 대기 중인 제안 N건은 바뀐 계정과 맞지 않아 실행되지 않습니다." + [AI 요청 승인 보기] 링크. 확인을 눌러야 저장(자동 취소는 하지 않음 — 실행 단계의 기존 대상 확인이 잘못된 계정 실행을 이미 막는다)

### D. 카탈로그·그리드

- `src/lib/integrations/catalog.ts`: 세 서비스 `kind: 'coming-soon'` → `'dialog'`, `adminOnly: true`, 키 발급 방법(`keyGuide`) 추가
  - Meta: 비즈니스 설정 → 시스템 사용자 → 토큰 생성(ads_read·ads_management), 앱 대시보드 → 앱 시크릿, 광고 관리자 계정 ID. 링크 `https://business.facebook.com/settings/system-users`
  - Google: Google Cloud 콘솔 OAuth 클라이언트 → OAuth Playground에서 Analytics·Tag Manager 범위로 refresh token 발급. 링크 `https://console.cloud.google.com/apis/credentials`. "개발 담당자 도움이 필요할 수 있음" 한 줄
  - 네이버: 검색광고 관리 → 도구 → API 사용 관리에서 액세스 라이선스·비밀키, 고객 ID. 링크 `https://manage.searchad.naver.com`
- `integrations-grid.tsx`: 세 서비스 본문에 `<AdCredentialForm provider=… onChanged={refresh} />`. `coming-soon` 분기는 다른 서비스가 쓰지 않으면 제거
- 상태 로더는 그대로(이미 `SpaceCredential` 존재·`healthError`로 판정)

## 테스트

- 라우트 GET: ADMIN 아님 403, 없는 provider 404, 미등록 `registered:false`, 등록 시 config 허용 필드만·비밀값/암호문 미포함
- 라우트 GET: `lastError`·`healthError` 원문이 응답에 없고 `hasError`만, 다른 Space id로 요청 시 403, `pendingActions` 집계(접두·상태·spaceId 조건)
- 라우트 PUT: Meta `graphVersion` 미입력 시 기존 값 보존, Meta·네이버 저장 성공 시 `healthError` 해제·`healthAlertedAt` 유지, Google 저장은 점검 상태 그대로. 기존 테스트(`__tests__`) 유지
- 폼: provider별 칸 렌더, 기존 매핑 채워 넣기, 행 추가·삭제·기본 브랜드, 행 1개면 자동 기본, 이름 중복 막기, 비밀값 빈 칸이면 저장 막기, 매핑 변경 + 대기 제안 있으면 경고 후 확인해야 저장, 서버 400 메시지 표시, MFA 필요 시 `redirectIfMfaRequired` 경로
- 그리드: 세 타일이 팝업으로 열림, MEMBER는 여전히 열 수 없음

## 검증

- `npm test -- <changed> --runInBand`, `npm run typecheck`, `npx eslint <changed>`, `npm run build`
- 로컬 dev(소유자 QA 계정): 세 팝업 데스크톱·390px, 빈 값·형식 오류 안내, 실제 저장은 하지 않음(가짜 토큰 저장 시 Meta·네이버 확인 실패 문구가 나오는지만 확인 — 확인 실패면 저장되지 않으므로 데이터 변화 없음). Google은 확인 호출이 없어 가짜 값이 저장되므로 시도하지 않는다
- 운영: 세 팝업 열기·기존 등록 상태 표시만 확인(저장 금지)

## 위험과 롤백

- GET이 config에 운영자 메모·내부 값을 노출할 위험 → provider별 허용 필드만 골라 반환, 오류 원문 미반환
- 동시 저장: 두 관리자가 동시에 저장하면 나중 요청이 이긴다(지금 API와 같음). 비밀값 병합이 없으므로 폐기한 키가 되살아나지 않는다
- 점검 cron과 저장이 겹치면 오래된 점검 결과가 새 설정에 기록될 수 있음 → 하루 1회 점검이고 다음 점검에서 바로잡혀 이번 범위에서 다루지 않음(보류)
- 저장된 설정 복구: 매핑을 잘못 바꾸면 팝업에서 다시 입력해 되돌린다(이전 값은 GET으로 저장 직전에 보이므로 화면에서 확인 가능). 코드 롤백은 PR revert
- Google은 저장 시 확인 호출이 없음(기존과 같음) → 팝업에 "저장 후 에이전트가 처음 조회할 때 확인됩니다" 안내
- DB 스키마 변경 없음. 롤백은 PR revert

## 검토 반영

Codex adversarial-review(2026-11-20) 지적 5건 — 반영 4, 부분 보류 1.

1. [high] 매핑 저장이 Meta `graphVersion`을 지움 → 서버가 기존 값 보존(B), 테스트
2. [high] 비밀값 병합과 동시 저장 경합(폐기 키 부활) → **병합 자체를 빼서** 해소. 저장마다 키 전체 입력(B)
3. [high] 매핑 변경 시 승인 대기 제안 처리 없음 → GET이 대기 건수 반환, 매핑 변경 시 경고·확인 + 승인 화면 링크(C). 자동 취소는 하지 않음(실행 단계 대상 확인이 이미 차단)
4. [medium] 저장 성공과 건강 점검 상태 모순 → 확인 거친 저장은 `healthError` 해제, Google은 그대로(B). **cron 경합은 보류**(하루 1회, 다음 점검에서 바로잡힘)
5. [medium] GET이 외부 오류 원문 반환 → `hasError` boolean만, 계정 ID 공개는 ADMIN·aal2 없음으로 명시 결정(A)

## 코드 리뷰 반영 (opus, 2026-11-20)

지적 11건(MEDIUM 2, LOW 9) — 반영 6, 보류 5. 막는 결함 없음.

- [medium] 대기 제안 수가 페이지를 연 시점 값 → 매핑이 바뀌었으면 저장 직전에 건수만 다시 읽어 판단(입력 중인 행은 덮지 않음)
- [medium] Meta 확인 호출이 보존한 graphVersion이 아닌 기본 버전으로 나감 → 병합한 config로 확인·저장, 테스트(Graph URL 버전)
- [low] 이전 config 조회 DB 오류가 "계정 확인 실패" 문구로 섞임 → 조회를 try 밖으로
- [low] 확인 거친 저장 후 `lastVerifiedAt` 미갱신 → `healthError` 해제와 함께 기록
- [low] 확인창에서 입력을 고친 뒤 [그래도 저장] 시 재검증 없음 → 다시 검사
- [low] 비밀값 10자 미만을 화면에서 안 막음 → 화면에서 안내
- 보류: upsert와 `healthError` 해제가 별도 쿼리(실패해도 저장은 유효, 다음 점검이 바로잡음) / 팝업 `hasError`(lastError 포함)와 타일(healthError만) 표시 차이(계획 A 문구대로) / 닫은 뒤 비밀값이 페이지 메모리에 남음(전송·저장 없음, 2단계 상시 마운트 설계) / 페이지 열 때 GET 3회 / spaceId 없는 관리자(구조상 발생 안 함)
