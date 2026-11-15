# 모집 관리 — 지원자 상세 화면 UI 개편

- 작성: 2026-11-16, grill-me 9개 결정(에디 확정). 참조: 오프닝워크 지원자 상세 화면
- 대상: `app/d/recruiting/applications/[id]/page.tsx` 와 `src/components/hiring-applicants/*`
- 브랜치: `feat/recruiting-applicant-detail-ui` (base `origin/develop`)

## 확정 결정

| #   | 결정                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 「내부 코멘트」→「메모」. 스레드(작성자·시각·수정) 유지. 데스크톱은 우측 패널에 메모 스레드 고정(sticky)                                                                                                                                                                    |
| 1-1 | 모바일(<lg): 제목 아래 요약 한 줄 「메모 N · 최근: …」(없으면 「메모 남기기」) → 탭하면 하단 Sheet 에 전체 스레드+입력                                                                                                                                                      |
| 2   | 본문 2구역: 「기본 정보」(이름·휴대폰·이메일·거주 지역·지원 공고/포지션·희망 매장·유입 경로·**지원 서류**=첨부 파일 이동, 휴대폰·이메일 「복사」) / 「사전 질문」(번호+굵은 질문, 아래 답변 문단, 구분선, 없으면 숨김). 위아래로 펼침(탭 아님)                              |
| 3   | 「상태 알림」·「문자 보내기」 → 「연락하기」 하나. 팝업 안 3방식: 문자(현 SmsSender) / 전화(번호·`tel:`·복사) / 상태 안내 링크(현 NotificationSender) + 「알림 발송 이력」을 상태 안내 링크 아래로 이동. 연락처 없으면 문자·전화 비활성+안내                                |
| 4   | 「모집 단계 변경」 팝업: 채용 단계(서류 접수/면접/최종 제안)·결과(진행 중/합격/불합격) 각각 단일 선택, 현재값 선택 상태, 「변경」은 바뀐 게 있을 때만 활성 → 한 번의 PATCH(`{stage, hiringStage}`) 후 `router.refresh()`. 불합격으로 바꿀 때 확인 문구. 모바일은 하단 Sheet |
| 5   | 제목: 이름 옆 상태 배지 1개 `{채용 단계} · {결과}`, 색=결과(진행 중 blue, 합격 emerald, 불합격 red — DESIGN §2.2 배경 배지 조합+dark 짝). 중복 지원·블랙리스트 배지는 그 오른쪽 작게. 아래 줄: 공고·포지션 · 지원일 · 유입 경로                                             |
| 6   | 하단 고정 액션 영역(본문 열 기준 가운데): 「모집 단계 변경」(보조) · 「연락하기」(primary). 흰 바탕+상단 테두리+약한 그림자, 모바일은 두 버튼 반반. 본문 하단 여백으로 가림 방지. `FloatingActionBar`(다중 선택 전용)는 쓰지 않고 이 화면 전용 컴포넌트                     |
| 7   | 블랙리스트: 제목 줄 우측 끝 회색 텍스트 버튼(금지 아이콘)「블랙리스트 추가」→ 기존 사유 팝업. 등록돼 있으면 「블랙리스트 등록됨」(회색, 블랙리스트 관리 화면 링크). 「지원자 삭제」는 추가하지 않음                                                                         |
| 8   | 「지원 이력」(오프닝 이관 원본, `ApplicationHistory`)은 본문 맨 아래 「이전 기록(오프닝워크)」 접힘 영역, 기록 없으면 숨김                                                                                                                                                  |
| 9   | `HiringApplication.memo`(오프닝 이관 단일 메모, 현재 미표시)를 메모 스레드 맨 위 「이전 메모(오프닝워크)」 읽기 전용 고정. 값 있을 때만, 모바일 요약 개수에 포함                                                                                                            |

## 변경 파일

- `app/d/recruiting/applications/[id]/page.tsx` — 레이아웃 재구성(서버 컴포넌트 유지, PII 는 서버에서 렌더). 그리드 `lg:grid-cols-3`: 본문 `lg:col-span-2`(기본 정보·사전 질문·이전 기록), 우측 `lg:sticky lg:top-4` 메모 패널(`hidden lg:block`). 제목 영역·모바일 메모 요약·하단 액션 영역 배치, 하단 여백 `pb-24`.
- 신규 `src/components/hiring-applicants/application-status-badge.tsx` — 결정 5 배지(서버/클라이언트 공용, 순수 표시).
- 신규 `src/components/hiring-applicants/stage-change-dialog.tsx` — 결정 4. 데스크톱 Dialog / 모바일 Sheet(`useMediaQuery` 대신 Tailwind 로 두 트리거를 나누지 않고, 하나의 컴포넌트에서 `matchMedia('(min-width:1024px)')` 로 Dialog·Sheet 선택). 기존 `stage-controls.tsx` 는 이 화면에서 더 쓰지 않으면 삭제(다른 사용처 grep 확인).
- 신규 `src/components/hiring-applicants/contact-dialog.tsx` — 결정 3. 내부 탭(문자/전화/상태 안내 링크). 문자=기존 `SmsSender` 내용 재사용(트리거 없는 본문 컴포넌트로 분리: `SmsComposer`), 상태 안내 링크=기존 `NotificationSender` 본문 분리(`StatusLinkPanel`) + 발송 이력 목록.
- `src/components/hiring-applicants/sms-sender.tsx`, `notification-sender.tsx` — 본문을 export 가능한 패널로 분리(다른 화면에서 쓰는 트리거 버전은 유지, grep 로 사용처 확인).
- 신규 `src/components/hiring-applicants/detail-action-bar.tsx` — 결정 6 하단 고정 영역(client, 두 팝업 트리거).
- `src/components/hiring-applicants/comment-thread.tsx` — 문구 「코멘트」→「메모」, `legacyMemo?: string | null` prop 으로 결정 9 고정 항목.
- 신규 `src/components/hiring-applicants/memo-mobile-summary.tsx` — 결정 1-1 요약 줄 + Sheet(내부에서 `CommentThread` 재사용, 초기값 공유).
- `src/components/hiring-applicants/detail-actions.tsx` — `BlacklistButton` 변형: 회색 텍스트 버튼 스타일, 등록 시 관리 화면 링크(결정 7).
- 신규 `src/components/hiring-applicants/copy-value-button.tsx` — 휴대폰·이메일 복사(값은 이미 같은 화면의 SmsSender 에 전달되는 수준. 이메일은 새로 client 로 전달됨 — 아래 위험 참조).
- `src/components/hiring-applicants/application-history.tsx` — 접힘(`<details>` 또는 Accordion) 래핑.

## 단계 (TDD)

1. 기존 테스트 파악: `stage-controls`, `comment-thread`, `notification-sender`, `sms-sender`, `application-history`, 상세 페이지 관련 테스트.
2. red → green 순서로:
   - `application-status-badge`: 결과별 색 클래스·라벨 조합.
   - `stage-change-dialog`: 현재값 선택, 변경 없으면 「변경」 비활성, 두 값 변경 시 PATCH 본문 `{stage, hiringStage}` 1회, 불합격 선택 시 확인 문구, 실패 시 오류 표시·재시도 가능.
   - `contact-dialog`: 탭 3개, 연락처 없으면 문자·전화 비활성 안내, 전화 탭 `tel:` 링크, 상태 안내 링크 탭이 기존 링크 생성 API 호출, 발송 이력 표시.
   - `comment-thread`: 「메모」 문구, `legacyMemo` 고정 항목(읽기 전용, 수정·삭제 버튼 없음).
   - `memo-mobile-summary`: 개수(이전 메모 포함)·최근 미리보기·없으면 「메모 남기기」, 탭 시 Sheet.
   - `BlacklistButton`: 미등록=텍스트 버튼+팝업, 등록=관리 화면 링크.
   - 사전 질문 렌더: 질문 번호·답변(배열은 쉼표 결합)·없으면 구역 숨김.
3. 페이지 조립 후 `tsc`·`eslint`·관련 jest·`next build`.
4. 로컬 dev QA(gstack-browse): 데스크톱 1440 / 모바일 390 — 제목 배지, 메모 우측 고정·모바일 요약·Sheet, 하단 액션 영역 가림 없음, 두 팝업, 블랙리스트 우측 상단. dev DB 지원서 1건으로 단계 변경 후 원래 값으로 되돌림.

## 검증·릴리스

- develop PR → 머지 → main release(cherry-pick 후 merge 직전 main 기준 tsc).
- 운영: 테스트 계정 qa2(「테스트」 공간, 모집 관리 사용)의 지원자 상세에서 화면 확인. 데이터 변경(단계 변경)은 원래 값으로 되돌림. 모바일 확인은 맥미니 iPhone 미러링(computer-use) 규칙을 따른다.

## 위험·고려

- **PII**: 페이지 원칙은 "PII 는 서버 렌더, 클라이언트 prop 미전달". 현재도 `SmsSender` 에 휴대폰·이름이 client prop 으로 간다. 이번에 이메일 복사 버튼이 이메일을 client 로 넘긴다 — 같은 화면에 이미 렌더되는 값이고 OWNER/구성원만 접근하는 화면이라 수용. 대안: 복사 버튼만 서버에서 `data-` 없이 렌더하고 클릭 시 DOM 텍스트를 복사(값 prop 불필요) — 구현 시 이 방식을 우선 검토.
- **동시 작업**: 열린 PR #1472(`fix/recruiting-sms-polish`)가 `sms-sender.tsx` 를 수정 중. 본문 분리 리팩터가 충돌할 수 있어, 머지 순서를 확인하고 develop 최신으로 rebase 후 PR.
- 하단 고정 영역이 모바일 Sheet·Dialog 와 겹치지 않게 z-index 확인.
- `stage-controls.tsx` 삭제 시 다른 사용처가 있으면 유지.

## 롤백

- 화면 전용 변경(스키마·API 변경 없음) — main revert PR 로 되돌림.
