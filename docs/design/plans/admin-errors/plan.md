# 오류(Sentry 자동 수정) 어드민 와이어프레임

화면: `admin.workdeck.work/admin/errors` (운영자 전용, 신규 route). 데이터는 Sentry API 직접 조회(DB 테이블 0개).

1. 상단 네비 맨 끝에 「오류」 추가 + 대시보드(`/admin`)에 섹션 카드 1개.
2. 러너 마지막 활동 한 줄 — 가장 최근 `autofix:` 노트 시각·내용. 별도 heartbeat 없음(중단 감지는 Slack 요약).
3. 서비스 탭(전체·웹·워커) — Sentry `service` 태그로 거른다(`runtime`은 Sentry가 덮어써서 못 씀). URL `?service=`.
4. 자동 수정 상태 필터 — 노트는 이슈별 조회라 서버에서 25건 받은 뒤 화면에서 거른다. URL `?status=`.
5. 자동 수정 상태 Badge = 마지막 `autofix:` 노트(요청됨·진행 중·PR 링크·분석만·실패·제외·없음).
6. 동작: 「수정 요청」(→ `autofix:request` 노트), 「제외」(→ `autofix:skip`). 둘 다 노트 1개라 서로 되돌리기 가능 → 확인 창 없음. 진행 중·PR 행엔 버튼 숨김.
7. 상세 화면 없음 — 스택·이벤트는 Sentry에서 본다. 환경은 production 고정(preview 오류는 Sentry에서).

## 구현 중 변경(11-21)

- 계획의 「서버 액션」 대신 API route(`POST /api/admin/errors/[issueId]`) — 기존 어드민 패턴(`fetchWithMfa` 제자리 MFA 재인증) 재사용.
- 탭 숫자: 웹(`!service:worker`)·워커 2회 조회 결과 길이(25면 `25+`), 전체 = 합. `statsPeriod`는 필터가 아니라 쿼리에 `lastSeen:-14d` 추가.
- 노트 조회는 `numComments > 0`인 이슈만. 캐시 없음(`no-store`) — 버튼 후 즉시 반영.
- 러너 마지막 활동은 현재 탭에 보이는 이슈들의 노트 기준.
