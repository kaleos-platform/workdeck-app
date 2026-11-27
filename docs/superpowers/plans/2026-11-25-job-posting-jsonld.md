# 채용 공고 JobPosting 구조화 데이터 (SEO 2단계 후속)

- 작성: 2026-11-25, **개정 2026-11-27**(기업 정보 #1655·#1657 배포 반영), 브랜치 `feat/job-posting-jsonld`(origin/develop 기준)
- 상위: `2026-11-23-seo-phase2.md` — JobPosting 은 「공개 회사명 출처·화면 표시」 미정으로 보류(에디 결정 11-23). 11-27 에디: 기업 정보 배포됐으니 지금 착수.

## 목표

공개 공고(`app.workdeck.work/p/[uuid]`)가 구글 채용 검색에 노출되도록 JobPosting JSON-LD 를 낸다. 구글 정책상 마크업 값은 **화면에 보이는 값과 같아야** 한다.

## 현재 (코드 대조, 11-27)

- 회사명 출처는 이미 있다: `HiringCompanyProfile`(공간당 1개, `companyName` 필수). 설정 「기업 정보」 탭에서 **저장한 공간만** 공개 공고 머리글(`page.tsx` header)·하단 기업 푸터(`CompanyFooter`)에 기업명이 보인다. 저장 안 한 공간은 `profile = null`.
- 기업 정보가 있으면 근무 장소(장소 이름 — 도로명 주소)가 푸터에 **항상** 보인다(`showIntro` 와 무관). 없으면 머리글에 주소 표시.
- 빌더 `src/lib/hiring/job-posting-jsonld.ts`(+`__tests__/job-posting-jsonld.test.ts`)는 미사용. 가드: ACTIVE·미리보기 아님·마감 전·포지션 1개+positions 블록 렌더·내부 지원 링크·도로명 주소·본문 텍스트. `title` 은 현재 공고 제목.
- 페이지 테스트 `app/p/[uuid]/__tests__/job-posting.test.tsx` 는 「JSON-LD 미출력」을 고정.
- JSON-LD 출력 컴포넌트 `src/components/marketing/json-ld.tsx`(이스케이프로 XSS 차단, SEO 2단계).
- `app/sitemap.ts` 는 정적 마케팅 URL 만. `app/robots.ts` 는 `/p/*` 허용(`/p/*/apply` 만 차단), sitemap 위치=마케팅 호스트. GSC 는 DNS 도메인 속성이라 `app.` 하위 도메인 URL 도 같은 sitemap 에 넣을 수 있다(교차 호스트 허용 조건 = 양쪽 소유 확인).
- `HiringPosting` 컬럼 추가는 이관 targetHash 를 바꾸므로 금지 → 스키마 변경 없음.

## 결정

1. **회사명 = `HiringCompanyProfile.companyName`**(저장된 공간만). 공간 이름은 쓰지 않는다. 기업 정보 없는 공간 = 출력 안 함(현재와 동일).
2. **title = 직무명**(`position.name`, 화면 positions 블록에 렌더). 공고 제목(홍보 문구 포함 가능)은 쓰지 않는다.
3. **마감일 있는 공고만**(상시 모집 제외) — `validThrough` 가 항상 있어 구글이 만료를 안다.
4. **jobLocation** = 화면에 보이는 도로명 주소 원문 + 앞 토큰 파싱 `addressRegion`(시·도)·`addressLocality`(시·군·구). 파싱 실패 시 두 필드 생략.
5. **운영사 긴급 차단 env** `HIRING_JOBPOSTING=off` → JSON-LD 만 끈다(화면 무변화).
6. 화면 UI 변경 없음(기업명·주소·직무명 모두 이미 보임).

## 변경 파일

1. `src/lib/hiring/job-posting-jsonld.ts`
   - `title` 입력 제거 → `position.name` 사용.
   - `companyName` trim 빈 값 → null, `closingDate` null → null 가드.
   - `parseKoreanAddress(road)`: 첫 토큰이 시·도(`…특별시|…광역시|…특별자치시|…특별자치도|…도` 또는 축약 `서울|부산|…|제주` 17개)면 region, 둘째 토큰이 `…시|…군|…구`면 locality. 세종(구·군 없음)은 locality 생략. `addressCountry: 'KR'` 유지.
2. `app/p/[uuid]/page.tsx`
   - `profile && process.env.HIRING_JOBPOSTING !== 'off'` 일 때 `buildJobPostingJsonLd` 를 `filterPosting` 결과(화면과 같은 값)로 호출, 결과가 있으면 `<JsonLd>` 렌더.
   - `hasInternalApplyLink`: 화면 로직과 같은 조건(button `linkType==='form'`+title, image/design `data.link.linkType==='form'`+imagePath).
   - `positionsBlockRendered`: positions 블록 존재 && positions.length>0.
   - `textBlocksHtml`: text 블록 `renderTiptapHtml(c.data)`(화면과 같은 함수).
3. **공고 전용 sitemap `app/p/sitemap.ts`**(→ `app.workdeck.work/p/sitemap.xml`). 마케팅 `app/sitemap.ts` 는 **건드리지 않는다**(lastmod=now 회귀·빌드 DB 접근 회피, Codex #3).
   - `export const dynamic = "force-dynamic"`(빌드 시 DB 미접근). 마케팅 sitemap 과 분리돼 있어 동적화 영향은 이 파일뿐.
   - 대상: 기업 정보가 있는 공간의 공고 중 ① ACTIVE + 마감일 있음 + 마감 전, ② 최근 30일 안에 CLOSED 되거나 마감일이 지난 공고(Google 이 제거를 발견하도록 남겨 둠). `url=buildAppUrl('/p/'+uuid)`.
   - `lastModified`: 마감 전 ACTIVE·조기 CLOSED = `updatedAt`(상태 변경 시 `@updatedAt` 갱신 → 조기 마감이 lastmod 를 올린다). 마감일 경과 = `max(updatedAt, 마감일 23:59:59 KST)`(경과 후에만 반영, 미래 날짜 금지, Codex #1).
   - 한도: `take: 50000`(sitemap 프로토콜 한도). 현재 공개 공고 수십 건 규모. `ponytail:` 주석 — 넘으면 `generateSitemaps` 분할(Codex #2).
   - DB 오류 시 빈 배열 반환 + Sentry 로 남김(마케팅 sitemap 과 무관).
   - `app/robots.ts`: `sitemap` 을 배열로 바꿔 `buildAppUrl('/p/sitemap.xml')` 추가. 추가로 에디가 GSC 도메인 속성에 `https://app.workdeck.work/p/sitemap.xml` 을 **명시 제출**하고 처리 상태·발견 URL 수 확인(Codex #4).
4. 테스트
   - 빌더: 직무명 title(공고 제목과 다른 사례), 회사명 빈값·마감일 없음 → null, 주소 파싱(서울특별시 강남구 / 서울 강남구 / 경기도 성남시 분당구 / 세종특별자치시 한누리대로 / 파싱 불가).
   - 페이지: 기업 정보 있음+마감일 → 1개 출력(name=기업명, title=직무명), 기업 정보 없음 → 0, 상시 모집 → 0, `HIRING_JOBPOSTING=off` → 0, 마감 지남/CLOSED → 0, **다른 spaceId 의 position·store·content 주입 → JSON-LD·HTML 어디에도 없음**(Codex #6).
   - sitemap: 대상·제외(기업 정보 없음·상시·31일 전 마감)·lastmod(마감 전=updatedAt, 미래 날짜 없음, 경과=마감 시각)·DB 오류 → 빈 배열. 조회는 `space.hiringCompanyProfile` 관계로 거른다.

## 범위 밖

- 복수 포지션 공고(포지션별 URL 설계 필요), Indexing API, 공고별 회사명 override, 화면 UI 변경.

## 검증

- jest(빌더·페이지·sitemap), tsc, eslint, `npm run build`.
- 로컬 dev: 기업 정보 저장 공간의 마감일 있는 공고 → `view-source` JSON-LD → 구글 「리치 결과 테스트」 코드 입력(오류 0, 경고 기록). 기업 정보 없는 공간 → 없음. `/sitemap.xml` 에 해당 공고 포함.
- 운영 배포 후: (a) `curl -I` 로 공고 `Cache-Control`·`x-vercel-cache` 확인. (b) ACTIVE 공고 1건 GSC URL 검사 → 「채용 정보」 인식(에디). (c) 테스트 공고 조기 마감 → noindex·JSON-LD 제거·sitemap lastmod 갱신 확인, 1주 뒤 GSC 결과 제거 점검(memory 에 날짜 기록).

## 긴급 제거 절차 (에디)

1. 전체 즉시 중단: Vercel env `HIRING_JOBPOSTING=off` + 재배포(에디 승인). 이 플래그일 때 공고 sitemap 은 그대로 두되 모든 항목 lastmod 를 **요청 시각**으로 올려(`app/p/sitemap.ts` 에서 같은 플래그 확인) 재크롤을 유도한다.
2. 영향 URL 확보: 차단 직전 `/p/sitemap.xml` 을 받아 URL 목록을 보관(Claude).
3. 이미 색인된 결과: 목록을 Search Console 「삭제」 도구로 임시 삭제(에디) → 1일 뒤 `curl` 로 마크업 제거(Claude)·GSC 삭제 요청 처리 상태(에디)를 각각 확인.
4. 특정 공간만: 고객(또는 운영사 어드민)이 해당 공간 공고를 **마감**(actions CLOSED → `updatedAt` 갱신, sitemap 에 30일 남아 lastmod 상승). 기업 정보 삭제 경로는 없으므로 쓰지 않는다. 마감이 불가하면 1번 전체 차단.

## 롤백

PR revert. 스키마·데이터 변경 없음.

## Codex 검토 반영 (2026-11-25, 1차 계획) — 지적 3건, 반영 3

1. [high] title=공고 제목 → 직무명으로 변경.
2. [high] 상시·조기 마감 통지 없음 → 마감일 있는 공고만 + sitemap lastmod + 조기 마감 운영 검증. Indexing API 는 계속 보류.
3. [high] 긴급 제거가 쓰기 가드·캐시에 의존 → env 스위치 + 배포 후 캐시 헤더 실측.

## Codex 검토 반영 (2026-11-27, 개정 계획) — 지적 6건, 반영 5, 보류 1

1. [high] 미래 마감일이 lastmod 를 덮음 → 마감 전 updatedAt, 경과 후에만 마감 시각.
2. [high] 1,000건 절단 → take 50000(프로토콜 한도) + 초과 시 generateSitemaps 분할 주석. 현재 규모 수십 건.
3. [high] 마케팅 sitemap 동적화 회귀 → 공고 전용 `app/p/sitemap.ts` 분리, 마케팅 sitemap 무변경.
4. [medium] 교차 호스트 sitemap → app 호스트에 두고 robots.txt 등록 + GSC 명시 제출·처리 확인.
5. [medium] 긴급 차단 후 색인 제거 공백 → URL 목록 확보·GSC 일괄 삭제·각각 확인 절차 추가. **Indexing API 는 보류**(서비스 계정·키 관리·할당량 부담, 공개 공고 규모 작음 — 필요해지면 후속).
6. [medium] 다른 공간 데이터 회귀 테스트 → 페이지 테스트에 다른 spaceId 주입 사례 추가.

## Codex 2차 검토 (2026-11-27) — 지적 2건, 반영 1, 보류 1

1. [high] 콘텐츠(HiringContent) 수정·삭제가 lastmod 에 안 잡힘 → **보류.** HiringContent 는 `updatedAt` 이 없고, 공고 행 `updatedAt` 을 억지로 올리면 이관 원장 스칼라 해시(schema 4279)에 영향. 모집 중 공고의 마크업이 콘텐츠 편집으로 빠지는 것은 만료 정책 위반이 아니며 Google 의 정기 재크롤로 처리된다. 만료·마감(정책상 필수 제거)은 `updatedAt`·마감 시각으로 반영됨.
2. [high] 기업 정보 삭제로 공간별 차단 불가(삭제 API 없음·sitemap 제외) → 공간별 절차를 「공고 마감」으로 교체, 불가 시 전체 차단.
