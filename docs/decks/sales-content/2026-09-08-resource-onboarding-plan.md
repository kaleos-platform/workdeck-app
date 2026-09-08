# 자료 기반 초기 설정 개선 계획

**목표:** 홈페이지·블로그·PDF·Markdown만 전달하면 기업 ESG 담당자 대상 콘텐츠에 필요한 브랜드·전체 상품·고객군 정보를 검토하고 저장할 수 있다.

**구조:** 기존 리소스의 PENDING/DONE/FAILED 상태를 수집 대기열로 사용한다. 짧은 요청으로 페이지를 하나씩 처리하고 연결된 상품·목록·소개·블로그 글을 발견한다. 전체 상품은 상품별 분석 결과를 합쳐 보존하며 하나의 프롬프트 길이 제한으로 누락시키지 않는다. 이미지 분석은 기존 워크스페이스 AI 설정과 쿼터를 따른다. DB 스키마와 새 외부 수집 서비스는 추가하지 않는다.

## 작업 및 검증

- [x] `src/lib/sc/onboarding/crawl.ts`, `app/api/sc/onboarding/resources/route.ts`, `app/api/sc/onboarding/collect/route.ts`: URL 정규화, 상품/카테고리/페이지 이동/블로그 발견, 중복 방지, 재개 가능한 대기열. 같은 상품의 category/display 변형 URL은 하나로 수렴. 실패 및 수집 한도는 사용자에게 표시한다.
- [x] `src/lib/sc/onboarding/extract.ts`, `storage.ts`: PDF·Markdown 지원, MIME이 비거나 text/plain인 .md 처리, PDF 실패 안내. 파일 크기 및 형식 검증 테스트.
- [x] `src/lib/ai/providers/*`, `src/lib/sc/product-import/extract.ts`: 이미지 바이트를 공급자별 입력으로 전달. 기존 SSRF 방어를 재사용하고 이미지 실패/부분 분석을 표시한다. 수납박스의 ec-data-src 실제 이미지, 이미지 전용 상세, 텍스트 전용 요청 회귀 테스트.
- [x] `src/lib/sc/onboarding/schemas.ts`, `prompts.ts`, `app/api/sc/onboarding/generate/route.ts`: 브랜드 근거·상품 소재/규격/주문조건/활용법/출처·고객의 구매 고민과 의사결정 기준을 customFields에 보존한다. ESG 인증·탄소절감 수치는 출처 없는 추정 금지. 모든 상품 초안을 합치며 5개 제한 제거.
- [x] `src/components/sc/onboarding/*`: 자료 전달→수집·분석→검토로 간소화. 고객군은 간단한 선택 입력. 수집 진행·실패·재개 및 초안 근거/미확인 항목 노출. 브랜드 기존값 보존, 상품 선택 저장, 중복 저장 방지.
- [x] 지정 수납박스 URL의 실제 HTML/이미지와 홈페이지·블로그 탐색 검증. 관련 Jest, typecheck, lint, build 및 가능한 UI 검증. 인증 후 DB 저장·화면 확인은 로그인 계정 부재로 수행하지 못했으며 QA 문서에 기록했다.

## 검증 기준 자료

- 홈페이지: https://meaninglab.co.kr/
- 블로그: https://m.blog.naver.com/meaning-lab
- 상품: https://meaninglab.co.kr/product/detail.html?product_no=62

이미지는 정보 분석에 사용한다. 사용자가 이미지 재사용·저장을 별도로 선택하지 않았으므로 콘텐츠용 공개 에셋으로 자동 저장하지 않는다.
