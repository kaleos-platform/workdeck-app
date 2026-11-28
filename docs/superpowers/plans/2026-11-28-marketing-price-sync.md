# 마케팅 가격 문구 DB 동기화 + 기한 약속 문구 제거

선행: 모집 관리 랜딩·요금제 구조 개편 `2026-11-28-recruiting-pricing-structure.md`(Codex 지적 1 「note·FAQ·이전 안내 고정 22,000원」 보류분).

## 목표

1. 업무 랜딩(`/[deck]`)의 가격 문구(hero note·FAQ 답변·오프닝 이전 안내 points)를 요금제 화면과 같은 원천(DB `BillingDeckProduct.monthlyPrice` → `getMarketingDeckStatus` + `withLivePrices`)으로 표시.
2. 「24시간 안에」·「영업일 기준 1~2일 이내」 같은 답변·안내 기한 약속을 마케팅 화면에서 제거(에디 11-27 결정).
3. DESIGN.md §8에 랜딩·요금제 구조 결정 한 줄.

## 현황 (조사)

- `app/(marketing)/[deck]/page.tsx`는 이미 `getMarketingDeckStatus()`(unstable_cache 태그 `deck-release`)를 await해서 JSON-LD 가격에만 쓴다. 본문 `content`는 정적 상수 `DECK_LANDINGS[deck]` 그대로 → 문구 속 가격은 상수.
- 가격 문구가 든 곳(`grep "[0-9],[0-9]{3}원"`): recruiting `hero.note`·FAQ 「이용 비용」·`migration.points[0]` 「정가 22,000원」, 준비중 4개(sales-content·coupang-ads·finance·seller-hub) FAQ 「월 N원 구독 상품」.
- 랜딩 `content.hero.note`·`faq`·`migration`을 읽는 곳은 `DeckLanding`(이 page)과 같은 page의 `faqJsonLd`뿐. llms.txt·og-image·pricing 화면은 이 필드를 안 읽는다(llms.txt 가격은 이미 `withLivePrices`).
- `월 13,500원 보장`은 오프닝 고객 보장가(lockedPrice 약속)라 DB 표시가와 별개 → 고정 유지.

## 설계 (Codex 반영 후)

가격 자리를 명시적으로 표시한다. 문구 상수에 자리표시자 `PRICE_TOKEN = '{price}'`(예: `'7일 무료 체험 · 이후 월 {price}(부가세 포함)'`, `'정가 {price}'`)를 넣고, `src/lib/marketing/pricing-data.ts`에 순수 함수 하나:

```ts
/** 랜딩 문구의 {price}를 실제 표시가로 채운다. 준비중(가격 null)이면 가격 문구를 뺀다. */
export function resolveLandingPrice(
  content: DeckLandingContent,
  totalPrice: number | null
): DeckLandingContent
```

- 판매 중(`released && price`): `hero.note`·`faq[].answer`·`migration.points[]`의 `{price}`를 `22,000원`(toLocaleString ko-KR + 원)으로 치환.
- 준비중(`null`): `{price}`가 든 FAQ 항목·migration point 제거, note는 undefined. → 본문과 FAQ JSON-LD 모두 가격 미노출(요금제·상품 상세·SoftwareApplication JSON-LD의 준비중 가격 미노출 규칙과 일치).
- `월 13,500원` 보장가는 자리표시자가 아니라 고정 문자열 → 영향 없음.
- page: 결과를 `DeckLanding`·`faqJsonLd`·`softwareAppJsonLd`에 같은 객체로 넘김. 가격은 기존처럼 `released && price ? price.totalPrice : null`.
- 자리표시자 누출 방지: 이 세 필드를 읽는 곳은 이 page뿐(grep). 테스트로 ① 전 업무 × 공개/준비중 결과에 `{price}` 0건, ② recruiting 위치별 기대 문구(note·FAQ·「정가 33,000원」·13,500원 유지)를 기본가와 다른 가격(33,000)으로 확인, ③ 준비중이면 가격 FAQ 제거, ④ 각 deck 데이터에 `[0-9],[0-9]{3}원` 고정 금액이 13,500원 외엔 없음(가격은 자리표시자로만).

### 폴백

- `getMarketingDeckStatus`는 DB 실패 시 이미 카탈로그 기본값을 돌려준다 → 랜딩 문구도 기본가(현재 22,000원)로 표시. 요금제 화면·llms.txt·JSON-LD와 같은 폴백이라 화면끼리 금액이 갈라지지 않는다.
- 「가격 언급 생략」 폴백은 쓰지 않는다: 실패 여부 신호가 없고(새 조회 경로 금지), 요금제 화면은 같은 상황에서 기본가를 보이므로 랜딩만 빼면 오히려 불일치.
- 알려진 한계(기존과 동일): 빌드 시 DB 실패면 기본가로 정적 생성되고 다음 어드민 가격·공개 변경(revalidateTag) 전까지 유지.

### 렌더 방식

- 변화 없음. page는 이미 같은 캐시 함수를 await 중이고, 새 조회·`dynamic`·`revalidate` 설정 추가 없음. `/recruiting` 등은 SSG(●) 유지, 어드민 PATCH의 `revalidateTag('deck-release')`로 갱신되는 구조 그대로. build 출력에서 확인.

## 기한 문구 (전 → 후)

| 위치                                           | 전                                                               | 후                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| recruiting FAQ 「신청하면 어떻게 이용하나요?」 | 담당자가 확인 후 24시간 안에 이메일로 이용 방법을 안내드립니다.  | 담당자가 확인한 뒤 이메일로 이용 방법을 안내드립니다.  |
| recruiting `finalCta.subcopy`                  | 도입 신청을 남기면 24시간 안에 이메일로 안내드립니다.            | 도입 신청을 남기면 이메일로 이용 방법을 안내드립니다.  |
| recruiting `leadForm.subcopy`                  | …담당자가 확인 후 24시간 안에 이메일로 이용 방법을 안내드립니다. | …담당자가 확인한 뒤 이메일로 이용 방법을 안내드립니다. |
| `lead-form.tsx` 완료 기본 문구                 | 담당자가 확인 후 24시간 안에 이메일로 안내드릴게요.              | 담당자가 확인한 뒤 이메일로 안내드릴게요.              |
| `contact/page.tsx`                             | 영업일 기준 1~2일 이내 답변드립니다.(Clock 아이콘 줄)            | 줄 삭제                                                |

- 넓힌 grep(하루 안에·N시간 안·이른 시일·며칠·영업일·N일 이내 답변, 블로그 원본 `content/blog` 포함): 위 5곳 + 메일 1곳 외 0건.
- 유지: `refund/page.tsx`·`pricing/[slug]` 「7일 이내 청약철회」「영업일 기준 3일 이내 환불 절차」는 답변 약속이 아니라 법정 환불 규정 → 손대지 않음.
- 보고만: 신청자 접수 확인 메일 `src/lib/marketing/lead-notify.ts:113` 「담당자가 확인 후 24시간 안에 이 메일 주소로 이용 방법을 안내드립니다.」(테스트 `lead-notify.test.ts:41-55`가 「24시간」 포함을 강제). 어드민 안내 메일에는 기한 약속 없음(grep 0건). 관리 세션이 판단.

## 변경 파일

1. `src/lib/marketing/pricing-data.ts` — `PRICE_TOKEN`·`resolveLandingPrice` 추가.
   1-1. `src/lib/marketing/decks/{recruiting,sales-content,coupang-ads,finance,seller-hub}.ts` — 가격 문구를 `{price}`로.
2. `app/(marketing)/[deck]/page.tsx` — content를 함수로 감싸 `DeckLanding`·`faqJsonLd`에 전달.
3. `src/lib/marketing/__tests__/pricing-data-live.test.ts` — 위 ①~④.
4. `src/lib/marketing/decks/recruiting.ts` — 기한 문구 3곳.
5. `src/components/marketing/landing/lead-form.tsx` — 완료 문구.
6. `app/(marketing)/contact/page.tsx` — 기한 줄 삭제(+ 안 쓰게 된 `Clock` import).
7. `DESIGN.md` §8 — 한 줄. 내용은 시안 `docs/design/plans/recruiting-pricing-structure/plan.md`에서만 가져온다: 고른 안(랜딩 좌측 히어로+실제 화면+주 CTA 1개+신뢰 줄+문제→결과, 요금제 판매 중 큰 카드 맨 위·준비중 작은 카드 아래·공통 조건 칩, 공용 템플릿은 선택 필드 있을 때만) / 버린 안=개편 전 배치(가운데 빈 히어로 — 무엇을 하는 도구인지 안 보임, 판매 중 카드가 준비중 4개 뒤 — 가장 늦게 보임, 「함께 쓰면 좋은 업무」 — 준비중으로 이탈). 시안에 없는 대안은 적지 않는다.

## 단계

1. sonnet 서브에이전트 구현(위 7개 파일).
2. opus 리뷰(diff).
3. 검증: `npx tsc --noEmit`, `npm run lint`, `npx jest src/lib/marketing src/components/marketing`, `npm run build`(라우트 표 `/recruiting`·`/pricing` ● 유지 확인), `next start`로 `/recruiting`·`/contact` HTML에 「24시간」「1~2일」 0건·「22,000원」 포함, 가격 치환은 jest로 확인. 데스크톱·390px 스크린샷(gstack-browse).
4. develop PR squash → release/\* cherry-pick(main 기준 tsc) → main PR 머지 → 운영 curl `/recruiting`·`/pricing`.

- visual-smoke(차단 체크)는 `/login`·`/signup`만 찍음(`e2e/visual-smoke.spec.ts` PAGES) → 이번 변경 화면과 무관, 스냅샷 갱신 불필요.

## 위험·롤백

- 자리표시자가 화면에 새는 위험 → 소비처가 page 하나, 테스트 ①로 고정.
- 롤백: main 커밋 revert. DB·env 변경 없음.

## Codex 리뷰 반영 (11-28, adversarial-review)

지적 3건 — 반영 2, 부분 반영 1.

1. [high] 준비중 업무 FAQ 가격 공개 → 반영: 준비중이면 가격 FAQ를 본문·FAQ JSON-LD에서 제거(설계 참고). 범위 밖 보고 항목은 삭제.
2. [high] 실제 가격 변경·캐시 무효화 경로 검증 없음 → 부분 반영: 기본가와 다른 가격(33,000)으로 위치별 출력 테스트 추가, `next start`에서 본문 가격과 SoftwareApplication JSON-LD `offers.price`가 같은 값인지 확인. 보류: 어드민 PATCH 후 재생성 실측 — 본문은 이미 JSON-LD가 쓰던 같은 렌더·같은 `unstable_cache` 결과를 읽을 뿐 새 캐시·조회가 없고, 가격 변경 무효화 경로는 #1391/#1393에서 운영 검증됨. 공용 dev DB 가격을 바꾸는 실측은 다른 세션 영향이 있어 하지 않는다.
3. [medium] 금액 문자열 치환이 의도 밖 금액을 바꾸고 드리프트 테스트가 약함 → 반영: 기본가 치환 대신 `{price}` 자리표시자로 위치를 명시, 위치별 기대 출력·13,500원 유지 테스트.
