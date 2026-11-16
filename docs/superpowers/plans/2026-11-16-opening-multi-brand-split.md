# 오프닝 다중 브랜드 고객 이전 — 브랜드별 별도 Space (디에스인)

## 목표

오프닝 관리자 1명이 운영한 두 브랜드를 **워크덱 Space 2개로 각각** 옮긴다(사용자 결정 2026-11-16: 「분리된 작업공간」).

- 511 「디에스인」 → 기존 Space 「(주)디에스인」(`cmwekcxi0000s08jhu5bnu3yu`)
- 510 「대성산업」 → 고객이 새로 만드는 Space(선행 조건, 없으면 510은 대기)
- 818(비활성) 제외. 지원자·계정 제외.

## 현재 막히는 점 (실측, 읽기 전용 prepare)

- 두 브랜드가 공고를 서로 복사해 써서, 한 브랜드 공고 안에 **다른 브랜드 소유 이미지·디자인**이 들어 있다. prepare는 소유 브랜드가 다르면 막는다.
  - `opening-prepare.ts:495` 파일 소유 → `ASSET_SCOPE_MISMATCH` (510 공고 52·템플릿 12, 511 공고 83·템플릿 15)
  - `opening-prepare.ts:678` content(디자인) 소유 → `RESOURCE_SCOPE_MISMATCH`
- 나머지는 브랜드 단위로 이미 동작한다. 원장 sourceRef는 원본 id 기준(전역 unique), Storage 경로는 `{spaceId}/migration/...`라 Space가 다르면 각자 복사된다.

## 변경 (최소, 기본 off)

1. `prepareOpeningCustomer` 옵션 `siblingBrandIds?: string[]`, CLI `prepare --sibling-brands <id,...>`.
   - **가드**: 원본 DB에서 대상 브랜드와 각 형제 브랜드가 활성 관리자(brand_member.member_type='admin', status=1, member.status=1)를 1명 이상 공유해야 한다. 아니면 원본 읽기 전에 `SIBLING_BRAND_UNVERIFIED`로 중단. 허용 쌍은 CLI의 정확한 id 목록뿐.
   - 형제 브랜드 자체의 공고·템플릿·매장·직무는 읽지 않는다. **대상 브랜드 공고·템플릿이 참조하는 파일·디자인의 소유 판정에만** 형제를 허용한다(`owner ∈ {brand, ...siblings}`, 위 두 곳). 소유 불명(`ASSET_SCOPE_UNKNOWN`)은 계속 막는다.
   - 요약에 형제 소유로 허용한 파일·디자인 수(`siblingOwned`)를 따로 집계해 사람 검토 때 보인다.
2. `OPENING_URL_REMAINS` 경고 오탐 수정: Excalidraw scene 최상위 `source`(화면에 안 보이는 메타데이터, AAK 실측 312건 전부)를 검사에서 제외. 적재 결과는 바뀌지 않는다.
3. 테스트(TDD): 형제 가드 통과/거부, 형제 소유 파일·디자인 허용과 `siblingOwned` 집계, 형제가 아닌 브랜드 소유는 계속 거부, 옵션 없으면 기존 동작, scene `source` 무시.

## 운영 절차 (각 운영 쓰기는 사용자 승인)

1. 릴리스 후 prepare 511 `--sibling-brands 510`(읽기 전용, SG 임시 개방·철회). 510은 고객 Space가 생긴 뒤 `--sibling-brands 511`.
2. 검토 요약: 건수, 형제 소유 허용 수, 연락처 적중(511: 전화 28·이메일 6), 이미지 → 사용자 승인 → review 파일.
3. packet → import dry-run(대상 Space 이름 확인, 충돌 0, `sameNameInTarget` 확인) → 승인 → `--apply`. 결과 status가 `APPLIED`인지 확인하고, `APPLIED_PARTIAL`이면 refused·held·conflict를 대조한다. prepare 포함 건수와 적재 건수를 대조한다.
4. 실행 기록(import 결과 JSON, 원장 targetId 수)은 저장소 밖에 남긴다. 롤백은 원장·템플릿 sourceRef 기준 레코드만 정리하고 Storage 파일은 지우지 않는다(별도 승인).
5. 보장가 `migrate-grant` → 화면 확인 → 완료 메일(Space별).
6. 일정: 「(주)디에스인」 모집 관리 체험 종료 11/20 14:56 KST. 이전이 그 전에 안 끝나면 migrate-grant 후 `set-trial`로 연장(사용자 승인). 510용 Space도 같은 기준.

## 검증

- jest `src/lib/hiring/migration`, tsc, eslint, build.
- 운영 prepare에서 형제 공유분의 `ASSET_SCOPE_MISMATCH`·`RESOURCE_SCOPE_MISMATCH`가 사라지고 `siblingOwned`로 집계되는지 확인.

## 롤백

- 코드: 옵션을 주지 않으면 기존 동작과 같다. 문제 시 revert.
- 데이터: 적재 전까지 쓰기 없음. 적재 후에는 위 4번.

## 하지 않는 것

- 두 브랜드를 한 Space로 합치기(Codex 지적: 같은 고객·합병 동의 증거 부족 → 사용자 결정으로 분리), 818 이전, 브랜드 간 중복 제거.

## Codex 비판 검토 반영

### 1차(합치기 안, needs-attention, 지적 4건) — 사용자 결정으로 「Space 분리」로 바꿔 혼입·이름 중복·공유 Storage 롤백 문제 자체를 없앰. 남은 부분은 2차에 반영.

### 2차(분리 안, needs-attention, 지적 2건 — 반영 2, 보류 0)

1. **[high] 부분 실패 후 원장 기준 일괄 정리는 기존 데이터·고객 수정을 지울 수 있음** → 반영.
   - 적용 직전에 대상 Space의 원장(`HiringMigrationRecord` sourceSystem=opening.work)·이전 템플릿(sourceRef 있는 `HiringDetailTemplate`) id 목록과 실행 시작 시각을 저장소 밖에 저장(읽기 전용 조회).
   - 롤백 대상 = 「실행 후 목록 − 실행 전 목록」(이번 실행 생성분)만. 삭제 전 원장 targetHash와 현재 상태 해시를 비교해 고객이 고친 항목은 제외하고 보고. 롤백은 별도 승인, Storage 파일은 지우지 않음.
   - 기본 복구는 재실행(항목 단위 멱등). 롤백은 재실행으로 해결 안 될 때만.
2. **[high] 두 Space에서 같은 원본 식별자 충돌 검증 누락** → 반영.
   - 구조상 공고·매장·직무·템플릿은 `brand_id = 대상` 행만 읽고 원본 행의 brand는 하나라 두 브랜드 packet의 원장 대상 id·template id는 겹치지 않는다. 형제 소유 파일·디자인 content는 원장 대상이 아니라 각 packet에 실려 Space별 경로로 복사된다.
   - 그래도 두 브랜드 적용 전에 사전 점검으로 두 packet의 (store·position·posting·template) 원본 id 교집합 = 0, 공고 uuid 교집합 = 0을 확인하고, 0이 아니면 중단한다.
   - 테스트: 형제 소유 파일·디자인이 대상 packet에 실리는지(prepare 단위). 두 Space 적재 통합 테스트는 위 사전 점검 + 운영 dry-run(두 번째 브랜드는 첫 적용 뒤 dry-run으로 충돌 0 재확인)으로 대신한다.
