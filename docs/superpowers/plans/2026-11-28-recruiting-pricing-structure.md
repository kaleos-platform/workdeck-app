# 모집 관리 랜딩·요금제 구조 개편

시안(에디 11-28 승인): `docs/design/plans/recruiting-pricing-structure/`(plan.md 번호 기준). 선행: 홈 리뉴얼 #1693/#1695.

## 목표

- `/recruiting`: 첫 화면에서 무엇을 하는 도구인지 보이고 버튼이 하나로 모이게(좌측 히어로+실제 화면, 신뢰 줄, 문제→결과). 나머지 섹션은 그대로.
- `/pricing`: 판매 중인 모집 관리가 맨 위에 보이게(큰 카드·포함 기능·도입 문의), 준비중 업무는 아래로.
- 준비중 업무 4개 랜딩은 화면 변화 없음(공용 템플릿의 새 배치는 데이터가 있을 때만).

## 변경 파일

1. `src/lib/marketing/types.ts`
   - `DeckLandingHero`에 선택 필드 `image?: DeckLandingScreenshot`(기존 타입 재사용). 있으면 좌측 정렬 2열 히어로.
   - `DeckLandingContent`에 선택 필드 `trustPoints?: string[]`.
   - `DeckLandingPainPoint`에 선택 필드 `result?: string`.
2. `src/components/marketing/landing/hero-section.tsx`
   - `hero.image`가 있으면 좌측 정렬 2열(텍스트 | 이미지), 주 CTA 버튼 하나, 보조 CTA(`secondaryCta`)는 「이미 쓰고 있다면 로그인 →」 같은 글자 링크로 낮춤.
   - 없으면 지금 가운데 배치 그대로(준비중 4개).
3. 신뢰 줄: 홈의 신뢰 줄 마크업과 같은 모양. `deck-landing.tsx`에서 `content.trustPoints`가 있으면 히어로 바로 아래에 렌더. 아이콘은 순서대로 고정 목록이 아니라 체크 아이콘 하나(`CheckCircle2`)로 단순화.
4. `src/components/marketing/landing/pain-points.tsx`: `result`가 있으면 카드 아래에 「→ 결과」 한 줄(파랑 강조 없이 foreground 굵게).
5. `src/lib/marketing/decks/recruiting.ts`
   - `hero.image` = applicants.webp(1600×1000, alt 기존 지원자 목록 alt 재사용).
   - `trustPoints`: 「7일 무료 체험」「언제든 해지」「알바몬·사람인·알바천국·잡코리아에 공고 링크 붙여넣기」 + `RECRUITING_AI_LIVE`일 때만 「지원자 개인정보는 AI로 보내지 않음」 — 각각 기존 FAQ(체험·해지), posting 기능·이미지(링크·HTML 붙여넣기), AI_FEATURE(개인정보 미전송)에 근거.
   - painPoints `result`: ① 「템플릿을 골라 내용만 바꾸면 공고 완성」 ② 「여러 공고의 지원자를 한 목록에서 상태별로 관리」 ③ 「진행 상태 탭과 블랙리스트로 바로 확인」(features 지원자 통합 관리 설명에 근거).
   - `relatedDecks` 삭제(세일즈 콘텐츠는 준비중).
   - `hero.note`(가격 문구)는 이번에 건드리지 않음(아래 Codex 반영 1).
6. `app/(marketing)/pricing/page.tsx`
   - 헤더 좌측 정렬, 부제 「쓰는 업무만 월 단위로 구독하세요. 표시 금액은 부가세 포함입니다.」
   - `releasedIds`로 판매 중 행과 준비중 행 분리. 판매 중 행마다 큰 카드: 이름·Badge 판매 중·가격(기존 VAT/공급가 표기 그대로)·포함 기능(`DECK_LANDINGS[slug].features.map(f => f.title)` — 공개 스위치 반영됨)·주 CTA 「도입 문의하기」(`DeckLanding`과 같은 분기: 그 업무 데이터에 `leadForm`이 있으면 `/${slug}#lead-form`, 없으면 `/recruiting#lead-form`)·「상품 상세·구매 →」(`/pricing/${slug}`)·「기능 소개 →」(`/${slug}`).
   - 공통 조건 줄: 「처음 만드는 작업 공간 7일 무료 체험」「매월 카드 자동결제」「언제든 해지」「취소·환불 규정 →」(`/refund`) — 기존 하단 안내문(VAT·자동결제·환불 기준) 내용을 칩으로 옮김, 안내문 문장은 유지.
   - 준비중 행: 작은 카드(아이콘·이름·Badge 준비중·「출시 알림 받기 →」 `/${slug}#apply`), 데스크톱 4열·모바일 2열.
   - 마지막 CTA 버튼 「시작하기」→「도입 문의하기」.
   - FAQ·faqJsonLd 그대로.

## 유지

- `/recruiting`의 `softwareAppJsonLd`(가격)·`faqJsonLd`, `/pricing` faqJsonLd, sitemap, 메타 — 무변경.
- id `lead-form`·`apply`, 오프닝 utm 블록, 리드 폼 로직, GA4 `cta_click`(로그인 글자 링크도 `/d/recruiting/login`이라 판정 안 바뀜 — 지금도 `/login` 정확 일치가 아니라 집계 안 되는 점은 그대로).
- `/pricing/[slug]`(PG 심사용 상품 상세) 무변경.
- 테스트 `src/lib/marketing/__tests__/recruiting-landing.test.ts`(미노출·이미지 존재 강제) 통과 유지.

## 단계

1. 타입·템플릿(hero·trust·pain result)·recruiting 데이터·가격 note — sonnet 1.
2. 요금제 페이지 — sonnet 2(파일 겹치지 않음).
3. 테스트: 준비중 랜딩(예: finance) 렌더 결과에 2열 히어로·신뢰 줄 없음, recruiting은 있음·버튼형 CTA 1개, AI 스위치 false면 AI 신뢰 문구 없음, 요금제는 판매 중 카드가 준비중 카드보다 먼저·포함 기능 5개·판매 중 업무에 leadForm이 없으면 CTA가 `/recruiting#lead-form`.
4. opus 리뷰 → 수정 → develop PR → release(cherry-pick, main 기준 tsc) → main → 운영 확인.

## 검증

- `tsc`, `eslint`, `jest src/components/marketing src/lib/marketing`, `npm run build`(`/recruiting`·`/pricing` 정적 유지).
- 로컬 dev 다크 선호에서 `/recruiting`·`/pricing`·`/finance`(준비중 — 변화 없음 확인) 데스크톱·390px 캡처, 가로 넘침 0.
- `next start` + `Host: workdeck.work`: 두 페이지 200, ld+json 개수·canonical이 운영과 같음.
- 배포 후 운영 두 페이지 캡처.

## 위험·롤백

- 공용 템플릿 변경이 준비중 4개를 바꿀 위험 → 선택 필드 없으면 기존 분기 그대로 + 테스트로 고정.
- 롤백: main 커밋 revert. DB·env 변경 없음.

## Codex 리뷰 반영 (11-28, adversarial-review)

지적 4건 — 반영 2, 보류 2.

1. [high] 히어로만 DB 가격으로 바꾸면 FAQ·FAQ JSON-LD·오프닝 이전 안내의 고정 22,000원과 충돌 — 보류: 히어로 가격 변경을 계획에서 뺐다. 가격 문구 전체(note·FAQ·이전 안내·JSON-LD) DB 동기화는 이번 구조 개편과 별개 후속으로 남긴다(지금 DB가=22,000원으로 일치).
2. [high] 판매 카드 CTA `/${slug}#lead-form`이 폼 없는 업무에서 깨짐 — 반영: `DeckLanding`과 같은 leadForm 유무 분기 + 다른 업무 공개 상태 테스트.
3. [medium] AI 신뢰 문구가 `RECRUITING_AI_LIVE`를 안 따름 — 반영: 스위치 종속, 테스트로 고정.
4. [medium] DB 조회 실패 시 시드 가격 노출 — 보류: 1을 빼서 새로 가격을 노출하는 곳이 없음. 요금제의 가격 표기는 기존 동작 그대로.

## opus 코드 리뷰 반영 (11-28)

blocking 0, should-fix 3 반영: 신뢰 줄 390px 넘침 위험 → 「채용 사이트에 공고 링크 붙여넣기」로 줄임(근거도 기능 설명 「어느 채용 채널에든」과 맞춤)·히어로 note와 겹치던 「7일 무료 체험」은 신뢰 줄에서 뺌 / 판매 중 0개면 결제 조건·VAT 안내 숨김(+테스트) / 판매 카드 반복 링크에 화면낭독기용 업무 이름. nit 반영: 로그인 라벨을 데이터로(문자열 비교 분기 삭제), 새 히어로 CTA `Button asChild`(a 안 button 중첩 제거), 히어로 이미지 `sizes`, 준비중 4개 데이터가 새 필드를 안 쓰는지 테스트. 보류: 히어로·기능 행 같은 applicants.webp 반복(가장 대표 화면, 에디 시안대로), 요금제 제목 단계(h2 건너뜀은 기존과 같음).
