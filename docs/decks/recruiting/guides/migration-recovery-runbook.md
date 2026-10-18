# 이전 실행 입력 복구와 최종 대조

2026-10-18 저장소 점검 기준. 실행 승인이나 운영 복구 성공 기록이 아니다.

## 현재 복구 근거

| 대상   | 저장된 근거                                                                                                               | 복구 한계                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 공고   | `posting-import.ts`가 원장 snapshot에 packet, 원본 content, target을 저장한다. metadata에는 positionMap이 있다.           | 운영 원장에 같은 형식이 저장됐는지 확인 전이다. 이미 변경된 공고를 재적재하지 않는다. |
| 지원서 | `application-import.ts`가 원본 snapshot과 `importDecisions`를 저장한다. 결정에는 공고·직무·매장·PII·파일 대응이 포함된다. | 적재되지 않은 보류/제외 지원서는 이 원장만으로 복구할 수 없다.                        |
| 무결성 | `decodeMigrationSnapshot`은 복호화 후 canonical JSON hash를 sourceHash와 비교한다.                                        | 복호화 성공만으로 현재 원본과 같거나 파일이 존재한다고 판단하지 않는다.               |
| 파일   | snapshot의 경로·크기·SHA256과 file-copy helper를 사용할 수 있다.                                                          | 원장에는 파일 바이트 자체가 없다. 실제 객체 다운로드 후 대조가 필요하다.              |

확인한 실행기는 `scripts/import-opening-posting.mjs`의 공고 단건 입력뿐이다. 고객별 추출·일괄 실행 CLI와 지원서 실행 CLI는 저장소 파일 목록에서 확인되지 않았다. `/private/tmp`와 저장소의 opening/peak 파일명 검색에서도 과거 고객별 실행 입력을 찾지 못했으나, 일부 디렉터리 접근 오류가 있어 전체 디스크에 없다고 단정하지 않는다. 다른 백업이나 운영 원장의 복구 여부를 먼저 확인한다.

## 읽기 전용 복구 순서

공고 또는 지원서 단건의 암호화 원장을 검사하는 공통 CLI를 추가했다. 기존에 승인된 환경에서 원장 암호화 버전에 맞는 복호화 키를 프로세스 환경에 제공하고 아래 명령의 placeholder를 확정된 값으로 대체한다. 키를 명령 인수에 넣거나 새 운영 환경변수를 내려받는 절차는 포함하지 않는다. 복구 검사는 PII 재암호화나 검색 hash 생성을 하지 않아 `HIRING_HMAC_KEY`가 필요하지 않다. 최신 main의 공통 암호화 모듈은 과거 v0(CBC)에 `ENCRYPTION_KEY`, v1(GCM)에 해당 key ID의 PII 전용 키 또는 `ENCRYPTION_KEY_V1` 루트를 사용한다. 키 회전 시 저장된 key ID에 맞는 기존 키가 필요하다. 누적 브랜치의 구 암호화 모듈만으로 v1 지원을 판단하지 않는다.

```sh
node scripts/audit-opening-recovery.mjs \
  --source-space '<원본 고객 ID>' \
  --target-space '<대상 내부 spaceId>' < '<암호화 원장 JSON 파일>'
```

입력 필드는 `spaceId`, `targetModel`, `transformVersion`, `sourceRef`, `sourceSnapshotAt`(ISO 문자열), `sourceHash`, `sourceSnapshotEnc`, `sourceSnapshotIv`다. `HiringPosting/posting-v1` 또는 `HiringApplication/application-v1`만 지원한다. 정상 출력은 `RECOVERABLE`, `writes: 0`과 공고/직무/매장 또는 지원서/파일/매장 수뿐이다. 실패는 고정 코드 `MIGRATION_RECOVERY_FAILED`와 exit 1이며 고객 원문을 출력하지 않는다. `--apply`는 거부한다. CLI는 DB 연결·파일 복사·복원 packet 저장을 수행하지 않으며 대상 현재 hash/실제 파일/최신 원본 대조는 아래 후속 절차다. `RECOVERABLE`은 packet의 무결성과 계획 검증을 뜻하고 고객 이전 완료를 뜻하지 않는다.

합성 암호화 원장으로 정상 복원, BIGINT 보존, 다른 고객/원본 ID/occurrence/시각/변환 버전/해시 불일치와 schema 오류의 원문 비노출, 실제 CLI 실행 및 쓰기 옵션 차단을 검증했다. 지원서는 기존 executor가 생성한 원장을 복구해 동일 입력 재실행 시 추가 생성 0건과 파일 대응 보존도 검증했다. DB는 합성 transaction 대역이며 실제 운영 원장 복구 시험은 미완료다.

검증 결과: 지원서 복구 확장 후 이전 관련 Jest 7 suites/137 tests, TypeScript, 전체 lint(오류 0·기존 경고 70), webpack production build 통과. 실제 운영 원장이나 고객 데이터를 사용하지 않았다. 최신 main `086f96f0`의 별도 worktree에서 암호화 v0/v1 복구를 추가 검증하여 관련 7 suites/139 tests가 통과했다. 기존 공고 전용 CLI 이름은 `audit-opening-recovery.mjs`로 변경했다.

1. 사용자가 승인한 원본 고객과 대상 Workdeck 계정의 대응을 사용한다. 내부 spaceId는 접근 범위를 제한하기 위한 값이며 사용자에게 공간 선택을 추가하지 않는다. 고객 이메일만으로 새로운 대응을 추정하지 않는다.
2. 대상 프로젝트와 계정 소속을 확인한 연결에서 해당 spaceId의 `HiringMigrationRecord`만 조회한다. 별도 명시 승인 없이 운영 비밀값을 새로 내려받지 않는다. 원문과 복호화 키는 로그·Git에 저장하지 않는다.
3. sourceRef의 system/table/sourceId/occurrence, targetModel, transformVersion을 검사한다. 알 수 없는 버전이나 동일 원본의 상충하는 대응은 보류한다. BIGINT ID는 문자열을 유지한다.
4. snapshot을 메모리에서 복호화하고 sourceHash를 검증한다. 공고는 snapshot의 target을 분리한 나머지를 packet으로 복원한다. 지원서는 importDecisions를 분리한 나머지를 snapshot으로 복원한다. 현재 코드의 입력 schema와 원본 고객·대상 spaceId를 다시 검사한다.
5. 대상 현재 행과 관계를 당시 executor와 동일한 정렬·JSON 투영으로 읽어 targetHash와 대조한다. 고객 수정, 삭제, 관계 변경은 충돌로 보고한다. hash를 현재 값으로 갱신하여 충돌을 숨기지 않는다.
6. 파일은 승인된 고객 참조 범위만 다운로드해 크기·SHA256을 비교한다. DB 행 존재, HEAD 성공, signed URL 발급을 파일 내용 일치로 간주하지 않는다.
7. 원본에서 새 읽기 전용 snapshot을 만들고 복구 원장에 없는 신규·변경·삭제 행과 보류·제외 행을 대조한다. 원장에 없는 행을 자동 제외하지 않는다. `이전 + 보류 + 제외 = 원본 범위`를 엔티티별로 증명한다.

## 재실행과 delta를 구분

기존 executor는 같은 sourceHash·transformVersion·targetHash에서만 재사용한다. 원본이 바뀌면 source conflict, 대상이 바뀌면 target conflict가 정상 결과다. 기존 공고가 발행되거나 지원자 단계가 변경된 경우 과거 packet으로 실행해서는 안 된다. 특히 지원서 executor는 연결 공고의 DRAFT·알림 비활성 조건을 요구하므로 현재 고객 업무 상태에서 그대로 사용할 수 있다고 가정하지 않는다.

최종 delta는 별도 계획으로 작성한다. 신규 행만 추가하는 경우에도 부모 공고의 현재 발행 상태·대상 수정·계정 권한을 확인한다. 기존 행 수정이 필요하면 변경 필드와 고객 수정 충돌 해결 정책을 먼저 확정한다. 원장 삭제, 대상 재생성, 발행 상태 임시 변경으로 충돌을 우회하지 않는다.

## 복구 완료 증거

- 승인된 계정 대응, 원본 snapshot 시각, 실행 커밋과 변환 버전
- 고객별 원장 총수 및 무결성 성공/실패, 대상 일치/충돌/누락 건수
- 원본 신규/변경/삭제와 승인된 보류/제외 대조
- 파일 검증 개수·총 bytes·checksum 실패/누락 수
- 제한 접근 저장소에 보관한 암호화 실행 입력과 그 복구 시험 결과
- 같은 계획 재실행 시 추가 생성 0건 및 실패 후 재개 결과

합성 테스트나 과거 559/140/19 집계는 이 운영 증거를 대신하지 않는다. 이 항목들을 확인하기 전에는 재실행 가능 또는 최종 이전 완료로 표시하지 않는다.
