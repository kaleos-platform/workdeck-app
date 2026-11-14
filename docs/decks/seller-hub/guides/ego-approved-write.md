# Ego GPT의 승인된 Cafe24 개발 스킨 검증

`browser_propose_cafe24_dev_check`는 등록된 개발 스킨 `/index.html` 끝에 고정 HTML 주석을 추가하고 재조회한 뒤 원문으로 복원하는 검증을 제안한다. 임의 HTML·스크립트·운영 디자인·로그인 제출은 지원하지 않는다.

제안 필드는 identity, mallId, shopNo, skinNo, skinCode, file, originalSha256, markerId다. 사전 조회한 원본 SHA-256을 전달한다. 원문·쿠키·토큰은 승인 payload에 넣지 않는다. 변경은 다음 문자열뿐이며 markerId는 영문·숫자·밑줄·단일 하이픈으로 제한된다.

```html
<!-- workdeck-ego-check:markerId -->
```

제안은 기존 AgentPendingAction에 PENDING으로 등록된다. ADMIN 이상의 구성원이 웹 상세에서 전문을 확인해야 승인할 수 있다. Slack·일괄 승인으로는 실행하지 않는다. 웹 승인 후 enqueue된 BrowserWriteJob만 호스트가 가져갈 수 있다. 승인 액션 EXECUTED는 접수 완료이고 외부 저장 성공을 뜻하지 않는다.

Space WorkerToken의 `x-worker-api-key` 인증만 claim/report할 수 있다. 세션·레거시 전역 키는 거부한다. 서버 claim은 미만료 PENDING 작업과 승인 액션 EXECUTED를 확인하여 원자적으로 RUNNING으로 전환한다. report는 같은 Space·claimId·토큰 ID만 받는다. 승인 유효기간은 1시간, 접수된 작업의 실행 시작 유효기간은 15분이다.

`browser_get_write_job`으로 현재 Space의 작업을 확인한다. 상태의 의미는 다음과 같다.

| 상태      | 의미                                                |
| --------- | --------------------------------------------------- |
| PENDING   | 승인 접수, 아직 실행하지 않음                       |
| RUNNING   | 호스트가 가져감. 중단됐어도 자동 재실행하지 않음    |
| RESTORED  | 저장본과 원본 복원 해시, TaskSpace 정리를 확인함    |
| ABORTED   | 저장 시작 전 중단했고 TaskSpace가 정리됨            |
| UNCERTAIN | 저장·복원·정리 결과를 확정할 수 없어 수동 확인 필요 |
| EXPIRED   | 실행하지 않은 작업의 시작 유효기간 만료             |

호스트는 workdeck-skills의 `paseo-ego` 패키지를 사용한다. `approved_write` 설정이 없으면 bridge는 비활성이다. 서버 migration/API와 호스트 기능을 함께 배포한 다음 실제 Workdeck Space ID·HTTPS origin·0600 워커 토큰 파일 경로를 등록한다. 토큰은 GPT worker에 전달하지 않는다. Paseo workspace ID와 Workdeck Space ID를 혼동하지 않는다.

쓰기 전 비대표 디자인 여부와 대상·원본 해시를 다시 읽고 원문을 로컬 백업한다. 저장 후 신선한 GET으로 변경본을 확인한 다음, 그 해시가 유지된 경우에만 원본을 저장하고 다시 확인한다. 오류 뒤 무조건 원복하거나 저장 버튼을 재클릭하지 않는다. 결과 불명은 사람의 확인 대상으로 남긴다.

검증 중 다른 편집·배포를 중지해야 한다. 기존 로컬 Cafe24 배포 도구와 대상 flock은 공유하지만 사람이나 외부 경로를 잠글 수는 없다. 저장 전 해시 검사는 Cafe24 서버의 원자적 조건부 저장이 아니다. 이 제약은 승인 전문에도 표시된다.

## 2026-11-14 검증 기록

- 격리된 로컬 PostgreSQL에서 Prisma migrate dev로 migration 생성·재적용, RLS 확인.
- 실제 DB에서 미승인·대상 변조 거부, 승인 실행 완료 전 claim 차단, 동시 8요청 승자 1개, Space·토큰 격리, 만료 작업 차단 검증.
- 독립 코드 리뷰에서 결과 신원 검사·JSON 파싱 오류·wrapper timeout 뒤 재호출 문제를 찾아 수정하고 회귀 테스트 추가.
- 실제 읽기 전용 사전 조회 `cafe24-dev-preflight-20261114-191657`는 `login_required`로 중단됨. TaskSpace 166 정리 완료. 원본 해시를 아직 확보하지 않았으며 실제 저장·복원은 검증하지 않았다.
- 운영 migration·호스트 쓰기 설정·실제 외부 저장은 이 검증에 포함하지 않는다. 재로그인 → 사전 조회 → 구체적 diff 웹 승인 → 실제 roundtrip 순서로 진행한다.
