# UI smoke 필수 체크 준비 — 경로 밖 PR 통과 처리

## 목표
`UI smoke` 워크플로의 `visual-smoke` 체크를 저장소 필수 체크로 등록할 수 있게 만든다. 지금은 `on.pull_request.paths` 필터라 UI 경로를 안 건드리는 PR에는 체크가 아예 생기지 않아, 필수로 걸면 그 PR이 영원히 대기한다.

## 현재 상태
- `.github/workflows/ui-smoke.yml`: `pull_request`(develop, main) + `paths` 필터, job `visual-smoke` 하나(Playwright 컨테이너, `next build` → 스크린샷·axe). #1569로 `continue-on-error` 제거됨.
- develop·main 모두 branch protection·ruleset 없음(`gh api .../rulesets` 빈 목록). 필수 체크 등록은 이 작업 범위 밖이며 머지 후 에디 결정.

## 변경 (파일 1개: `.github/workflows/ui-smoke.yml`)
1. `on.pull_request.paths` 제거 → 모든 PR에서 워크플로 실행.
2. 새 job `changes`(ubuntu-latest, 컨테이너 없음): `actions/checkout@v4` `fetch-depth: 2`(기본 체크아웃 = PR merge 커밋 `refs/pull/N/merge`) 후
   `git diff --no-renames --name-only HEAD^1 HEAD`(= 현재 base 대비 이 PR이 실제로 바꾸는 파일)를 기존 paths와 같은 정규식으로 검사해 `outputs.ui=true|false`.
   - event의 base/head SHA 대신 merge 커밋 부모를 써서 force-push·base 이동·merge base 계산 문제를 피한다. 충돌로 merge ref가 없으면 checkout 실패 → 아래 3의 안전 경로.
   - `--no-renames`: UI 경로 밖으로 옮긴 파일도 삭제로 잡혀 `ui=true`(Codex 지적).
   - 정규식: `^(app/|src/components/|components/|e2e/visual-smoke\.spec\.ts|e2e/visual-smoke\.spec\.ts-snapshots/|package-lock\.json$|\.github/workflows/ui-smoke\.yml$)`
   - `git diff` 실패는 grep과 분리해 step 실패로 만든다(pipefail로 false 판정되는 것 방지).
3. `visual-smoke`: `needs: changes`, `if: ${{ !cancelled() && needs.changes.outputs.ui != 'false' }}`.
   - UI 경로 밖 PR → `ui=false` → job skipped → GitHub는 skipped job을 필수 체크 성공으로 취급.
   - `changes`가 실패해 출력이 비면 `!= 'false'`라 visual-smoke가 **실행**된다(실패 시 안전 쪽). 
4. 상단 주석을 새 동작으로 갱신.

새 의존성(`dorny/paths-filter` 등) 없이 git만 쓴다.

## 검증
- 정규식·`--no-renames`: 로컬에서 UI 파일을 경로 밖으로 `git mv`한 임시 커밋과 문서만 바꾼 임시 커밋으로 판정 스크립트를 돌려 true/false 확인.
- 실패 안전 경로: 이 PR에 `changes` step을 일부러 `exit 1`하는 임시 커밋을 먼저 올려 visual-smoke가 **실행**되는지 확인한 뒤 되돌린다.
- 이 PR 자체는 워크플로 파일을 바꾸므로 `ui=true` → visual-smoke 실행·통과 확인.
- 경로 밖 판정: 이 브랜치에서 문서만 바꾼 임시 커밋으로 `ui=false`·visual-smoke skipped를 보는 대신, 머지 후 develop에 올라오는 첫 비UI PR에서 `visual-smoke`가 Skipped로 보이는지 확인(`gh pr checks`). 로컬에서는 정규식을 실제 파일 목록 몇 개로 `grep -E` 검사.
- `actionlint`가 있으면 실행.

## 위험·롤백
- 모든 PR에 `changes` job(약 10~20초) 추가. visual-smoke 비용은 그대로.
- 필수 체크로 아직 등록하지 않으므로 머지 흐름에는 영향 없음.
- 롤백: 이 커밋 revert(paths 필터 복귀). 단 필수 체크 등록 **후**에는 revert 전에 ruleset에서 `visual-smoke`를 먼저 빼야 한다(안 그러면 비UI PR이 다시 대기).
- 필수 체크 등록(ruleset 생성)은 머지 후, 비UI PR에서 Skipped를 실제로 본 뒤 에디 승인으로 한다.

## Codex 계획 검토 반영
- rename 누락 → `--no-renames` 반영.
- 실패·생략 경로 검증 → 강제 실패 커밋·로컬 판정 테스트 반영. fork PR(저장소 공개)도 `pull_request` 이벤트로 merge ref 체크아웃·git만 쓰고 비밀값이 없어 같은 경로로 동작 — 별도 조치 없음.
- 등록 후 롤백 순서 → 반영.

## 배포
develop PR → 머지 → `release/ui-smoke-gate`로 main cherry-pick PR.
