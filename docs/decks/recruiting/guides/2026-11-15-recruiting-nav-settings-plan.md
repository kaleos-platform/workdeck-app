# 모집 관리 내비게이션·설정·공고 상세 정리 계획 — 2026-11-15

## 목표 (사용자 결정, grill 2026-11-15)

1. 사이드바 「설정」 그룹 제거 → 「홈 / 공고 관리 / 지원자 / 설정」 4개 최상위 링크.
2. 「설정」 화면(`/d/recruiting/settings`)에 「매장 관리 | 직무 관리」 탭.
3. 메시지 템플릿 기능 완전 제거 — 화면·API·지원자 상세 템플릿 선택·랜딩 문구 제거와 `HiringMessageTemplate` 테이블 삭제 마이그레이션을 한 PR로(운영 확인 결과 참조).
4. 공고 템플릿은 사이드바에서 제거, 공고 관리 화면 우측 상단(「새 공고」 옆)에 「공고 템플릿」 버튼.
5. 지원자 목록 화면 우측 상단에 「블랙리스트」 버튼(사이드바 진입점 대체).
6. 공고 상세 탭을 「공고 상세 | 지원자 n」 2개로. 「공고 상세」 탭 = 왼쪽(약 45%) 모집 기간·접수 상태·안내·HTML 복사·지원서/공고 링크 + 오른쪽(약 55%) 공고 미리보기(sticky, 기본 모바일·PC 전환). 좁은 화면은 미리보기를 아래로.

## 변경 파일

- `src/components/layout/sidebar.tsx`, `src/components/layout/__tests__/sidebar-recruiting.test.tsx` — 설정 섹션 제거, `설정` 링크(`RECRUITING_SETTINGS_PATH`) 추가. 활성 판정: `/d/recruiting/settings/**`.
- `src/lib/deck-routes.ts` — `RECRUITING_SETTINGS_PATH` 추가, `RECRUITING_MESSAGE_TEMPLATES_PATH` 제거.
- `app/d/recruiting/settings/layout.tsx`(신규) — 제목 「설정」 + 경로 기반 탭(`settings/stores`, `settings/positions`, 링크·`aria-current`). `app/d/recruiting/settings/page.tsx`(신규) — `settings/stores`로 redirect. 기존 `settings/stores`·`settings/positions` 페이지는 자체 제목을 탭 레이아웃과 중복되지 않게 정리.
- 메시지 템플릿 제거: `app/d/recruiting/message-templates/page.tsx`, `app/api/hiring-applicants/message-templates/**`, `src/components/hiring-applicants/templates-manager.tsx`, 관련 validation(`src/lib/validations/hiring-applicants.ts`의 메시지 템플릿 스키마), 테스트. `src/components/hiring-applicants/notification-sender.tsx`의 템플릿 fetch·선택 UI 제거(결과 확인 링크 생성·복사 기능은 유지). 레거시 catch-all `app/d/hiring-applicants/[[...rest]]/page.tsx`는 SEGMENT_MAP 값이 아니라 원래 경로를 붙이므로 `message-templates`를 명시적으로 지원자 목록으로 redirect하고, 현재 경로 `/d/recruiting/message-templates`도 페이지 대신 redirect로 둔다. 구·현 경로 redirect 테스트 추가.
- 랜딩 `src/lib/marketing/decks/recruiting.ts` — 조건부 문구 양쪽, 비교표, 기능 카드의 title·headline(「안내 문구는 템플릿으로…」)·description, 덱 설명까지 메시지 템플릿 언급 전부를 「지원자별 결과 확인 링크(복사해 문자·메신저로 전달)」로 수정, 기능 카드 「메시지 템플릿 & 결과 안내」 → 「결과 안내 링크」. 운영 배포된 기능만 표시(표시=실제). 랜딩 데이터에 「템플릿으로 안내/메시지 템플릿」 표현이 남지 않는 테스트 추가.
- 공고 템플릿 진입: `app/d/recruiting/postings/page.tsx` 헤더 액션에 「공고 템플릿」 버튼(`RECRUITING_DETAIL_TEMPLATES_PATH`). `/d/recruiting/templates` 경로·화면은 유지.
- 블랙리스트 진입: `app/d/recruiting/applications/page.tsx` 헤더 우측에 「블랙리스트」 버튼. `/d/recruiting/blacklist` 화면은 유지(뒤로가기는 지원자 목록).
- 공고 상세: `app/d/recruiting/postings/[id]/page.tsx`, `src/components/hiring-posts/posting-detail.tsx` — `tab` 값 `recruit|applicants`로 축소(`content`는 `recruit`로 처리해 기존 링크 호환), 라벨 「공고 상세」, 2열 레이아웃(lg 이상), 미리보기 기본 모바일 — 공유 `PreviewFrame`(위저드와 공용, 내부 state가 pc로 시작)에 `defaultMode` prop을 추가해 상세에서만 mobile 지정, 위저드는 pc 유지(양쪽 초기 모드 테스트). `src/lib/deck-routes.ts`의 `getRecruitingPostingPath` tab 타입에서 `content` 제거.
- MCP·이메일 등 다른 곳에서 메시지 템플릿을 참조하는지 grep으로 확인(현재 위 목록 외 없음).

## 선행 조건 (Codex 리뷰 반영)

- 1차 배포 전에 운영 `HiringMessageTemplate` 사용 여부(Space 수·건수, 집계만)를 확인한다. 0건이면 1차·2차를 합칠 수 있다. 데이터가 있으면 해당 고객 안내와 내보내기(또는 읽기 전용 경로) 없이 화면을 제거하지 않는다. 운영 조회는 자동 모드가 차단 → 사용자 확인 또는 허용 필요.

## 단계

1. 사이드바·설정 탭·공고 템플릿/블랙리스트 진입점.
2. 공고 상세 탭·2열 레이아웃.
3. 메시지 템플릿 1차 제거 + 랜딩 문구.
4. 테스트 갱신·추가, 로컬 dev(dev DB, QA 계정) 데스크톱 1440·모바일 390 확인.
5. PR(base=develop) → 체크 → 머지 → release 브랜치(origin/main 기반 cherry-pick, 최신 main 기준 tsc) → 사용자 확인 후 main.
6. 테이블 삭제 마이그레이션 `20261115140000_drop_hiring_message_template`(shadow DB 오류로 수동 SQL + dev `migrate deploy`). 운영은 Vercel 빌드의 `migrate deploy`가 적용.

## 검증

- jest: `src/components/layout src/components/hiring-posts src/components/hiring-applicants src/lib/hiring src/lib/marketing app/d/recruiting app/api/hiring-posts app/api/hiring-applicants`
- `npm run typecheck`, 변경 파일 eslint, `npm run build`
- 화면: 사이드바 4링크·활성 표시, 설정 탭 이동·직접 URL, 공고 관리 「공고 템플릿」, 지원자 「블랙리스트」, 공고 상세 2탭·2열·모바일 스택, 지원자 상세 상태 알림(템플릿 선택 없이 링크 생성), 랜딩 `/recruiting` 문구.
- 제거된 경로: `/d/recruiting/message-templates`는 404(또는 지원자 목록으로 redirect — 북마크 대비 redirect 채택), API는 404.

## 롤백

- 1차는 코드만 변경(스키마 무변경) → 이전 배포로 Vercel promote 또는 revert PR. 메시지 템플릿 데이터는 DB에 그대로 남아 복원 가능.
- 2차 테이블 삭제는 되돌릴 수 없으므로 운영 건수 확인과 사용자 승인 후에만 진행.

## Codex 리뷰

- 지적 4건 — 반영 4: 레거시 catch-all redirect 명시, 랜딩 headline·description 포함 전수 수정+테스트, PreviewFrame `defaultMode` prop, 운영 데이터 확인을 1차 배포 선행 조건으로 이동(데이터 있으면 안내·내보내기 후 제거).

## 운영 확인 결과 (2026-11-15)

- 운영 `HiringMessageTemplate` 읽기 전용 집계(사용자 허용): 공간 1곳, 1건, `lastUsedAt` 없음(미사용). 내용·공간 식별자는 조회하지 않음.
- 사용자 결정: 화면·API 제거와 테이블 삭제를 이번 PR에서 한 번에 진행(2단계 분리 취소). 미사용 1건은 복구 불가 삭제를 감수.
