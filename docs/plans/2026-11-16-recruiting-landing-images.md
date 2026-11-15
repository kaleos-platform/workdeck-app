# 모집 관리 랜딩 기능 이미지·문구 정리 (2026-11-16)

## 목표

`workdeck.work/recruiting` 기능 행에 실제 앱 화면 이미지를 넣고, 문구를 현재 앱(UI 개편 #1427·#1448 이후)에 맞춘다. 「결과 안내 링크」는 핵심 기능이 아니므로 랜딩에서 뺀다. (사용자 grill 결정 2026-11-15)

## 결정 사항

1. 이미지 = 실제 화면 캡처(운영 테스트 계정 qa2) + 이메일은 실수신 메일, AI는 승인 대기 화면.
2. 데모 데이터: qa2 공간 이름 「테스트」→「한빛인력」, 공고 3~4개, 공개 지원서로 가상 지원자 약 12명(이메일 없이, 1건만 `hello+demo@ameaning.co.kr`), 단계·메모 혼합. 실고객 데이터 없음.
3. 캡처 형식: 기능 영역만 자름(사이드바·헤더 제외), 1280px·2배, 라이트 테마, 얇은 테두리·둥근 모서리, `public/marketing/recruiting/*.webp`. 랜딩 하단 스크린샷 섹션은 렌더하지 않되, `screenshots[0]`은 요금 페이지(`/pricing/recruiting`)가 쓰므로 새 지원자 목록 이미지로 교체해 유지.
4. 문구: 「상세 템플릿」→ 앱 용어(「공고 템플릿」·「워크덱 제공」 템플릿). 공고 디자인 행에 「워크덱 제공 템플릿·이전 공고 복사로 바로 시작」, 지원자 관리 행에 「진행 상태별 탭」 한 구절.
5. 결과 안내 제외: 기능 행 삭제, Hero 부제·SEO 설명·페인포인트 3·워크플로 3단계·FAQ 알림 답변에서 결과 안내 문장 삭제/수정. 오프닝 대응표 「자주 쓰는 메시지」 행은 유지(간단 문구).
6. AI 이미지: qa2에 임시 에이전트 토큰(hiring scope, 만료 1일) 발급 → `hiring_propose_posting_draft` 1건 → 승인 대기 화면 캡처 → 거절 → 토큰 폐기.

## 변경 파일

- `src/lib/marketing/decks/recruiting.ts` — 문구·features `image` 필드·결과 안내 행 삭제·`screenshots[0]`을 새 지원자 목록 이미지로 교체
- `public/marketing/recruiting/*.webp` 5장 추가(공고 디자인, 공개 공고·지원서, 지원자 목록, 이메일, AI 승인), `dashboard.png` 삭제(참조 0 확인 후)
- `src/components/marketing/landing/deck-landing.tsx` — `featureStyle === 'rows'`이면 `ScreenshotShowcase`를 렌더하지 않음(기능 행에 이미 이미지, 중복 방지). `FeatureRows`는 `image` 좌우 교차 배치를 이미 지원

## 단계

1. 운영 데모 데이터 준비(브라우저 UI 조작, `gstack-browse`, qa2 로그인은 메모리 `reference_prod_test_accounts` 절차 — 비밀번호·TOTP 비출력).
2. 캡처 → 크롭·webp 변환(`sips`/`cwebp` 등 로컬 도구, 새 의존성 없음).
3. 이메일: `hello+demo@` 지원 → Gmail 접수 메일 캡처. 일일 요약은 다음날 09:00 수신분(선택, 접수 메일만으로도 가능).
4. AI: 위 6번 절차.
5. `recruiting.ts` 수정, `next/image` 크기(width/height) 실제 비율로.
6. 검증 → develop PR 직접 머지 → `release/*`(origin/main + cherry-pick) → main 머지 → 운영 확인.

## 검증

- `npx tsc --noEmit`, eslint(변경 파일), `npm run build`, `jest src/lib/marketing`.
- 로컬 `next start`에서 `/recruiting` 데스크톱·390px 캡처, axe serious 0, 이미지 용량(장당 300KB 이하 목표)·alt 텍스트 확인.
- 이미지에 실고객 정보·비밀값·토큰이 없는지 눈으로 확인.
- `/pricing/recruiting` 제품 이미지가 새 지원자 목록 이미지로 보이는지 확인
- 「결과 안내」·「상세 템플릿」 잔존 grep 0, deck/덱 0, JSON-LD·llms.txt·`/pricing/recruiting` 반영 확인.
- 운영 배포 후 workdeck.work/recruiting 이미지 로드 확인.

## 롤백

- 랜딩: release PR revert(이미지·문구만, 스키마 없음).
- 데모 데이터: qa2 공간 이름 원복(「테스트」), 데모 공고·지원자는 유지 또는 삭제(사용자 판단). 에이전트 토큰은 캡처 직후 폐기, 초안은 거절해 공고 미생성.

## 리스크

- qa2 공유 계정 이름 변경 → 다른 검증 세션 혼동 가능(메모리에 기록).
- 공개 지원서로 넣은 데모 지원자 → qa2 소유자에게 다음날 일일 요약 메일 1회.
- 결과 안내 기능은 메인 체크아웃 세션이 변경 중 — 랜딩에서 빼므로 충돌 없음.

## Codex 리뷰

지적 1건 — 반영 1: `screenshots` 제거 시 요금 페이지 제품 이미지 소실 → `screenshots[0]` 새 이미지로 교체 유지 + 랜딩은 rows일 때 쇼케이스 미렌더.
