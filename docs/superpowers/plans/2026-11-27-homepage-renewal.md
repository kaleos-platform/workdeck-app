# 워크덱 홈페이지 리뉴얼 (라이트·소상공인 대상 전환형)

시안·결정: `docs/design/plans/homepage-renewal/`(plan.md, home-a·home-a-mobile 확정, home-b 버림)

## 목표

- 맥 다크 모드여도 마케팅 사이트(workdeck.work)는 항상 밝게. 앱 화면 테마(시스템 따라감)는 그대로.
- 홈(`/`)을 안 A 구조로 새로 짠다: 히어로(H1 1개·부제·파랑 CTA 1개·실제 화면) → 신뢰 줄 → 반복·흩어진 일→결과 3개 → AI 활용 → 업무 벤토 → 시작 3단계 → FAQ → 마지막 CTA.
- 헤더·푸터·업무 랜딩 5개·요금제·소개는 **톤만** 정리: 그라데이션 글자·파랑→하늘 띠·업무별 무지개 아이콘 타일 제거, 브랜드 색 blue-600 + 무채색, 강조색은 CTA에만. 구조 개편 없음.

## 확정 결정 (에디, 11-27)

- 범위 홈+헤더·푸터, 업무 랜딩·요금제는 톤만. 메시지=워크덱 전체 브랜드. 색=blue-600.
- 사회적 증거 자료 없음 → 가짜 로고·수치·후기 금지. 신뢰 줄 4개: 7일 무료 체험 · 언제든 해지 · AI 제안은 사장님이 승인해야 반영 · 지원자 개인정보는 AI로 보내지 않음.
- 사업자 정보는 신뢰 요소로 쓰지 않음. 전화 상담·답변 기한 약속은 어디에도 쓰지 않음(푸터 사업자 정보·고객센터 번호는 전자상거래 법정 표기라 기존대로 유지).
- 문제→결과에 「반복되고 파편화된 업무 개선」과 「AI로 생산성」을 담는다.

## 변경 파일

1. **테마 고정**
   - `src/lib/marketing/routes.ts`: `isMarketingPath(pathname)` = `/` 이거나 `MARKETING_ONLY_PATHS`(`/recruiting`처럼 슬래시 포함) 중 하나와 같거나 그 하위(proxy.ts `isPathOrChild`와 같은 판정). proxy.ts는 건드리지 않음(운영 라우팅 위험 회피). 문자열만 다루므로 Edge 번들 제약 유지.
   - `src/components/providers/theme-provider.tsx`: `usePathname()`으로 마케팅 경로면 next-themes `forcedTheme="light"`. `setTheme`는 쓰지 않음(로컬 저장된 앱 테마 선호를 건드리지 않음). 앱 경로는 지금처럼 system.
   - 운영은 마케팅/앱 도메인이 분리돼 있고, 앱 도메인의 마케팅 경로는 proxy가 마케팅 도메인으로 보내므로 경로 판정만으로 충분. dev(단일 오리진)는 같은 판정이 그대로 맞음.
2. **홈** `app/(marketing)/page.tsx` 재작성. 섹션 컴포넌트는 `src/components/marketing/home/`(hero, trust-strip, pain-results, ai-band, deck-bento, start-steps, home-faq, final-cta 중 필요한 만큼, 서버 컴포넌트). FAQ는 기존 `landing/faq-section.tsx`(Accordion) 재사용.
   - 이미지: 기존 `public/marketing/recruiting/applicants.webp`(히어로·벤토), `ai.webp`(AI 띠). 새 이미지 없음.
   - 벤토: `MARKETING_DECK_SLUGS` + `getReleasedDeckIds()` 그대로 — 공개 업무는 큰 카드(「지금 사용 가능」), 준비중은 작은 무채색 카드(「출시 알림 받기」→ `/{slug}#apply`). 하드코딩으로 recruiting을 박지 않고 released 여부로 판정(공개 업무가 늘어도 깨지지 않게, 큰 카드는 첫 공개 업무).
   - 기존 「6개 업무」 같은 틀린 숫자 제거.
3. **톤 정리**: `marketing-header.tsx`, `marketing-footer.tsx`, `landing/{hero-section,cta-section,feature-grid,feature-rows,workflow-section,deck-cross-links,deck-landing}.tsx`, `app/(marketing)/{pricing/page,pricing/[slug]/page,about/page}.tsx`.
   - 그라데이션 글자 → 일반 글자(강조 줄은 `text-blue-600`). CTA 띠 → `bg-blue-50` 바탕 + 파랑 버튼. 아이콘 타일 → `bg-blue-50 text-blue-600`(또는 `bg-muted`) 단색. `DECK_META.gradient`(앱도 사용)는 수정하지 않고 마케팅 컴포넌트에서 안 쓰게만.
   - 주 CTA 버튼: `bg-blue-600 hover:bg-blue-700 text-white`. 보조는 outline/ghost.
   - OG 이미지(`opengraph-image.tsx` 2개)는 이번 범위 밖(SNS 미리보기, 다크 아님) — 그대로 둠.
4. **문서**: `DESIGN.md` §8 결정 기록 1줄(마케팅 = 라이트 고정·blue-600 단일 강조, 앱 §2.1 「새 파랑 금지」의 마케팅 예외 / 버린 안 B).

## 유지해야 할 것 (깨지면 안 됨)

- 홈 `generateMetadata`(title·canonical `/`), `orgJsonLd`·`websiteJsonLd`, sitemap·robots·llms.txt(데이터 출처 `DECK_LANDINGS` 무변경).
- CTA 링크: 주 CTA는 지금처럼 `buildMarketingUrl('/recruiting#lead-form')`(도입 문의=가입 경로), 로그인은 `buildAppUrl('/login')` — GA4 `cta_click`은 `/login`·`/signup` 앵커 href로 판정하므로 로그인 링크 형태 유지. utm 블록(`UtmOnly`)·리드 폼은 건드리지 않음.
- `deck`·`덱`·기술 용어 없음. 쉬운 한국어.
- 애니메이션 추가 없음(필요성 낮음, 성능·접근성 위험만 있음).
- GA4: 도입 문의 버튼 클릭도 `cta_click`(cta=`lead`)으로 잡는다 — `google-tag.tsx` `onDocumentClick`에서 같은 오리진·마케팅 오리진 앵커의 hash가 `#lead-form`이면 `lead`. 실제 전환은 기존 폼 제출 `generate_lead` 그대로.

## 단계

1. 테마 고정 + `isMarketingPath` 단위 테스트(`src/lib/marketing/__tests__/`): `/`, `/recruiting`, `/blog/x`, `/pricing/recruiting` → true / `/my-deck`, `/login`, `/settings`, `/recruitingx`, `/dashboard` → false.
2. 홈 섹션 구현(sonnet 서브에이전트). 홈 문구 테스트: 렌더 HTML에 `전화`·`deck`·`덱`·`1~2일` 없음, 주 CTA href가 `/recruiting#lead-form`.
3. 헤더·푸터·랜딩·요금제·소개 톤 정리(sonnet).
4. opus 리뷰(diff) → 수정.
5. 검증 후 develop PR(squash) → `release/*`(origin/main 기준 cherry-pick) → main PR. release 전 `rm -rf .next/types`, merge 직전 main 기준 `npx tsc --noEmit`.

## 검증

- `npm run lint`, `npx tsc --noEmit`, `npx jest src/lib/marketing src/components/marketing`, `npm run build`.
- 로컬 dev(포트 3237, APP·MARKETING URL 같이 오버라이드)에서 Playwright `colorScheme: dark`로 `/`, `/recruiting`, `/pricing`, `/about`, `/blog` 캡처 → 전부 밝게. 같은 dark 설정으로 `/login`(앱 화면)은 어둡게 유지되는지 확인.
- 데스크톱 1280·모바일 390 스크린샷, 390에서 글자 넘침 없음.
- 홈 버튼 클릭 → `/recruiting#lead-form` 도착, 로그인 → `/login`.
- `e2e/visual-smoke.spec.ts`는 `/login`·`/signup`만 비교 — 테마 변경이 이 둘에 영향 없음을 확인(앱 경로라 system 유지).
- 테마 경계(production build `next build && next start`):
  - 서버 HTML의 next-themes 인라인 스크립트에 마케팅 경로는 forcedTheme `light`가 실리는지(curl, `-H 'Host: workdeck.work'`), 앱 경로(`/login`)는 안 실리는지.
  - localStorage `theme`=`dark`/`light`/`system` 각각에서 dark 선호로 `/` 직접 진입 → 밝음, 저장값은 그대로(변경 없음).
- 분리 도메인: `next start`에서 `Host: workdeck.work`로 `/`·`/recruiting`·`/pricing` 200과 canonical·JSON-LD 2개, `/p/<uuid>` 308(앱 이동, proxy 무변경) 확인.
- GA4: 로컬에서 `track` 호출을 가로채 홈·헤더 도입 문의 클릭 시 `cta_click`(cta=lead) 1회, 로그인 클릭 시 cta=login 확인.
- 배포 후 운영 workdeck.work를 다크 설정으로 열어 밝게 나오는지, JSON-LD 2개·canonical 유지 확인.

## 위험·롤백

- 위험: `isMarketingPath` 누락 경로(새 마케팅 페이지 추가 시) → 다크로 보일 뿐 기능 영향 없음. 앱 경로 오판정 → 앱이 라이트 고정 — 단위 테스트로 막음.
- 위험: next-themes forcedTheme 첫 렌더 깜빡임 — 서버 렌더 때 `usePathname`이 값을 주므로 인라인 스크립트에 forcedTheme이 실림. 캡처로 확인.
- 롤백: main에서 해당 커밋 revert → 재배포. DB·스키마·env 변경 없음.

## Codex 리뷰 반영 (11-27, adversarial-review)

지적 4건 — 반영 3, 일부 보류 1.

1. [high] 경로 판정 형식·404 — 반영: proxy와 같은 `isPathOrChild`를 공유. 보류: 마케팅 호스트의 **미등록 경로 404**는 목록 밖이라 시스템 테마를 따른다 — 서버가 호스트를 알면 루트 레이아웃이 동적이 돼 마케팅 정적 생성이 깨지므로 받아들인다(404 화면만 해당, 기능 영향 없음). `/p/[uuid]`는 앱 경로로 테마 정책도 앱과 같음.
2. [high] SSR·이동·저장값 — 반영: 검증에 서버 HTML 스크립트·저장값 3종 직접 진입 추가. 보류: 앱↔마케팅 **클라이언트 이동 시 잠깐 이전 테마**는 단일 오리진(dev·preview)에서만 생김 — 운영은 도메인이 달라 이동이 항상 전체 로드라 해당 없음.
3. [medium] 도입 문의 클릭 미계측 — 반영: `cta_click` cta=`lead` 추가(위 GA4 항목).
4. [medium] 분리 도메인·폼 제출 — 반영: `next start` + Host 헤더로 분리 도메인 응답 확인 추가. 보류: 도입 문의 실제 POST는 운영자 Slack·메일 알림이 실제로 나가므로 하지 않음 — 리드 폼·API 코드는 바꾸지 않는다.

## 구현 중 바뀐 결정 (opus 코드 리뷰 반영, 11-28)

- 테마 판정을 경로 문자열(`isMarketingPath`)에서 **실제 매칭된 route group**(`useSelectedLayoutSegments()[0] === '(marketing)'`)으로 바꿨다. 어드민 도메인 루트는 proxy가 `/`→`/admin`으로 rewrite해 주소창 경로가 `/`라 경로 판정이면 라이트로 오판정된다(리뷰 S3). `isMarketingPath`와 그 테스트는 삭제, proxy.ts·routes.ts 무변경.
- 홈 AI 문구 정정(리뷰 B1): 「AI 제안은 승인해야 반영」은 사실이 아니다 — 쓰기 권한을 준 에이전트의 내부 쓰기는 바로 실행된다(#1528, `src/lib/agent/actions/create.ts` `tryAutoExecute`). 사실인 「AI가 만든 공고는 '작성 중' 초안으로만 저장되고 게시는 직접」으로 바꿈. 신뢰 줄은 「AI는 초안만, 게시는 직접」.
- 업무 카드: 공개 업무가 둘 이상이면 두 번째부터 「자세히 보기」(준비중 배지·출시 알림 아님), 섹션 부제에서 모집 관리 이름 제거(S1·S2). 큰 카드 이미지는 히어로와 겹치지 않게 `editor.webp`(N3). 반복 링크에 화면낭독기용 업무 이름(N2).
- 문구: 지원서는 「워크덱 지원서로 받으면」 한 목록(S5), FAQ 개인정보처리방침 언급 삭제(S4), 체험은 「처음 만드는 작업 공간」(N1).
- 보류: `#apply` 클릭 계측(N4 — 출시 알림과 체험 신청이 섞여 의미가 흐려짐), OG 이미지 그라데이션(N5 — 범위 밖). 모집 관리 랜딩 `recruiting.ts`의 AI 「승인해야 반영」 문구·alt도 같은 이유로 낡았으나 이번 범위(톤만) 밖 → 후속.
- GA4 퍼널 기준선: 이번 배포부터 `cta_click`에 cta=lead가 더해져 합계가 늘어난다.
