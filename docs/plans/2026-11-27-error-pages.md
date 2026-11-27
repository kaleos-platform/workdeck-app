# 오류 페이지 구성 (404·화면 오류·전체 오류)

## 목표

Next 기본 영문 화면(`404 This page could not be found.`, `Application error`) 대신 한국어 안내와 복귀 버튼을 보여 사용자가 바로 다시 쓰게 한다.

## 현재 상태 (develop `dd91d344`)

- `app/not-found.tsx`, `app/error.tsx` 없음 → 기본 영문 화면.
- `app/global-error.tsx` 있음: `Sentry.captureException` + `<p>문제가 발생했습니다</p>` + 맨 버튼. 스타일 없음.
- `instrumentation.ts`의 `onRequestError = Sentry.captureRequestError`로 서버 오류는 서버에서 보고됨.
- `app/d/recruiting/error.tsx`는 모집 관리 안(사이드바 유지) 오류 화면 — 그대로 둔다.
- `proxy.ts`의 비-admin 도메인 `/admin` 은닉은 빈 본문 404 응답이라 새 화면이 렌더되지 않는다 — 그대로 둔다(admin 존재 노출 방지).
- 앱 도메인 `/` → `/my-deck`(비로그인 → 로그인), 마케팅 도메인 `/` → 랜딩. 복귀 링크는 상대경로 `/` 하나로 도메인별 분기 없이 맞는 곳에 간다.

## 변경 파일

1. `app/not-found.tsx` (신규, 서버 컴포넌트)
   - 가운데 정렬: `Workdeck` 글자 → 큰 `404`(muted) → "페이지를 찾을 수 없습니다" → "주소가 바뀌었거나 삭제된 페이지예요. 주소를 다시 확인하거나 홈에서 다시 시작해 주세요." → [홈으로](`/`, `<Link>`) [이전 페이지로].
   - "이전 페이지로"는 작은 클라이언트 버튼(`document.referrer`가 같은 출처일 때만 표시, `history.back()` — `history.length`는 외부 사이트 기록도 세서 쓰지 않음). 같은 파일 하단이 아니라 `app/_components/back-button.tsx`(클라이언트 경계 필요).
   - `metadata.title = '페이지를 찾을 수 없습니다 | Workdeck'`. noindex는 Next가 not-found에 자동 적용.
2. `app/error.tsx` (신규, 클라이언트)
   - "문제가 생겨 화면을 보여드리지 못했어요" / "잠시 후 다시 시도해 주세요." → [다시 시도](Next 16.2+ `retry()` prop — 다시 불러오기+재렌더, 공식 권장. `reset()`은 재요청을 안 해서 쓰지 않음) [홈으로] → `error.digest` 있으면 작은 글씨 `오류 번호: {digest}`.
   - Sentry: 항상 `Sentry.captureException(error)`. digest만으로 서버 보고 성공을 보장할 수 없어 생략하지 않는다(Codex 지적). 서버 오류는 서버·클라이언트 이벤트 2건이 될 수 있으나 누락보다 낫다.
3. `app/global-error.tsx` (수정)
   - 같은 문구·배치. 루트 레이아웃이 없으므로 자체 `<html lang="ko"><body>` + `import './globals.css'`로 색 토큰 사용. ThemeProvider 없음 → 시스템 다크는 지원 안 해도 됨(라이트 고정).
   - 다시 시도 = `retry()`. 홈으로 = `<a href="/">`(라우터가 깨졌을 수 있어 일반 링크). `metadata` 불가 → React `<title>`.
   - 기존 무조건 `Sentry.captureException` 유지.
4. `app/_components/back-button.tsx` (신규, 클라이언트) — 위 "이전 페이지로" 버튼.
5. `app/my-deck/error.tsx` (수정) — 모집 오류 화면 대신 `@/app/error` 재수출. 홈의 오류도 새 화면(홈·오류 번호·Sentry)을 쓰고 사이드바는 유지(코드 리뷰 반영).
6. `app/d/recruiting/error.tsx` (수정) — `useEffect`로 `Sentry.captureException(error)` 추가. 화면은 그대로(사이드바 안 표시).

공통 틀은 컴포넌트로 빼지 않는다(마크업 몇 줄 중복, global-error는 어차피 별도 문서).

## 단계

1. 위 파일 작성.
2. `npm run lint`, `npx tsc --noEmit`, `npm run build`.
3. production 서버(`next start`)에서 확인 (아래 검증). 임시 throw는 확인 후 제거하고 빌드 재확인.
4. 커밋 → PR(base=develop) → 머지 → develop 고정 URL에서 확인 → release PR(base=main).

## 검증

- 없는 주소(`/no-such-page`, `/d/sales-content/contents/없는id`) → 새 404, 홈으로·이전 페이지로 동작.
- 직접 진입(기록 없음)일 때 "이전 페이지로" 숨김.
- error.tsx: 임시로 오류를 던지는 페이지를 dev에서만 만들어 화면·다시 시도 확인 후 삭제(커밋 금지).
- global-error: dev에서 루트 레이아웃 임시 throw로 확인 후 원복.
- 라이트/다크, 모바일 폭(375px) 캡처.
- 응답 코드: 미매칭 URL과 `notFound()` 경로 모두 `curl -I`로 확인. streaming 시작 뒤 `notFound()`는 200일 수 있음(Next 문서) — 그 경우 noindex 메타 주입 확인.
- main 릴리스 후 운영 3개 도메인 실측: `workdeck.work/없는주소`, `app.workdeck.work/없는주소`(로그인·비로그인), `admin.workdeck.work/admin/없는주소` → 홈으로 눌러 각각 랜딩·`/my-deck`(또는 로그인)·`/admin` 도착 확인. 비-admin 도메인 `/admin`은 계속 빈 404.

## Codex 리뷰 반영

지적 5건 — 반영 4, 부분 반영 1: 도메인별 `/` 이동은 기존 `proxy.ts` 로직 그대로라 사전 통합 테스트 대신 릴리스 후 운영 실측으로 확인.

## 위험·롤백

- 위험 낮음: 신규 파일 위주, 데이터·스키마·API 무변경.
- 롤백: PR revert.

## 로컬 운영 빌드 검증 (2026-11-27)

`next build` + `next start`, `NEXT_PUBLIC_APP_URL`·`MARKETING_URL`=localhost, `ADMIN_URL`=127.0.0.1(분리 도메인 재현).

- `/a/b/c`(어떤 경로에도 안 걸림) → 404, 단독 화면, 제목 「페이지를 찾을 수 없습니다 | Workdeck」.
- `/no-such-page`·`/blog/없는글` → 404. `(marketing)/[deck]`·`blog/[slug]` 안 `notFound()`라 Next 구조상 마케팅 머리글 안에 표시됨(합의안과 차이, 구조 변경 없이 못 바꿈). 제목 템플릿 중복은 `title.absolute`로 해결.
- `/admin`(비-admin 호스트) → 빈 404 유지.
- 직접 진입 시 「이전 페이지로」 숨김, 사이트 안에서 넘어오면 표시·`/pricing` 복귀 확인. 「홈으로」 → `/`.
- 서버 오류 → 새 오류 화면 + 오류 번호, 브라우저 오류 → 오류 번호 없이 표시, 루트 레이아웃 오류 → global-error(제목·오류 번호).
- 라이트/다크·375px 확인. 임시 오류 페이지·레이아웃 throw 제거 후 재빌드.
- `dynamicParams = false` 시도는 효과 없어 되돌림.
