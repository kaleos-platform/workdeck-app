# 운영 키를 사용하는 이전 원장 검사

Sensitive 키를 내려받지 않고 기존 운영 Function에서 공고·지원서·매장 원장의 복호화·sourceHash를 검사한다. 대상 데이터와 Storage를 변경하지 않는다.

## 구현 계약

- `POST /api/worker/hiring-migration-audit`, 최신 `authenticateWorker`·`workerOwns` 재사용. 공간 토큰은 해당 공간만, 레거시 키는 기존 전환 플래그가 켜진 경우에만 허용한다. 인증의 사용 시각 갱신도 끄며 cron 등록·실행 이력 쓰기는 없다.
- 대상 customer enum은 `ameaning`, `peakpay`만 허용한다. 서버에서 이미 승인된 대상 계정으로 대응하고 단일 OWNER 멤버십을 재확인한다. 입력 spaceId·이메일·임의 고객 지정은 거부한다.
- READ ONLY transaction에서 첫 공고 원장의 sourceSpaceId·범위를 복구 검증해 기준으로 삼고, 같은 고객 원장만 id 순으로 25개씩 검사한다.
- 첫 요청에 읽은 마지막 원장 ID를 through로 고정한다. 이후 after/through 페이지를 순차 조회한다. 완료를 판단하려면 모든 페이지의 checked 합계를 total과 대조해야 한다.
- 공고·지원서는 기존 복구 함수를 사용한다. 매장은 sourceHash 무결성만 확인하며 공고·지원서 입력 schema 검증으로 표현하지 않는다.
- 원장/target ID·source ID·키·원문은 응답하지 않는다. 불투명한 페이지 경계 ID와 모델별 검사 집계만 반환한다. Cache-Control은 private, no-store.
- 오류는 고정 코드만 반환하고 원본 예외를 로그에 출력하지 않는다. 무인증·잘못된 입력은 DB 접근 전에 거부한다.

## 검증과 한계

합성 암호문으로 정상·손상·다른 고객·원본 ID 불일치 및 응답 원문 비노출을 검증한다. 실제 운영 검증은 배포 후 기존 서버 인증으로 호출하며, 임시 인증 파일은 삭제한다.

이 경로는 원장 복구 검사다. 현재 대상 hash와 원본 DB 범위는 별도 검증 결과를 사용하며 이미지 원본 manifest·실제 bytes 대조는 후속 범위다. 실제 고객 알림·재적재·수정·삭제·서비스 전환은 포함하지 않는다.

## 운영 호출

승인된 기존 서버 인증 설정을 접근 제한된 환경 파일에 준비한 뒤 호출한다. 복호화 키는 로컬 파일에 필요하지 않다. CLI는 목적지를 `https://app.workdeck.work`로 고정하고 redirect를 거부한다. 환경 파일을 shell에서 source하거나 인증값을 명령 인수에 넣지 않는다.

```sh
node scripts/audit-opening-runtime.mjs --env /secure/workdeck.env --customer ameaning
node scripts/audit-opening-runtime.mjs --env /secure/workdeck.env --customer peakpay
```

CLI는 같은 through를 유지하면서 페이지를 순차 요청하고 마지막 checked 합계가 total과 다르면 실패한다. 반복 cursor·상한 변경·비정상 집계도 거부한다. exit 0은 조회 범위 내 무결성/복구 오류 없음, exit 2는 검토할 실패 건수 있음, exit 1은 호출 또는 완주 검증 실패다. total은 별도 원장 집계와도 비교해야 한다. 페이지마다 별도의 읽기 snapshot이므로 전체 작업 동안 원본·대상 쓰기를 동결했다고 가정하지 않는다.

로컬 검증: 관련 Jest 10 suites/171 tests, CLI 4 tests, TypeScript·전체 lint(오류 0/기존 경고 63)·webpack production build 통과. 실제 운영 결과는 배포 후 별도 기록한다.

## 파일 대조

`--assets`를 붙이면 원장 1건씩 순회하며 검증된 공고 이미지 블록과 지원서 첨부의 manifest를 복구한다. DB transaction 종료 후 현재 대상 Storage 객체를 GET하여 원장에 기록된 대상 크기·SHA256과 비교한다. 원문·경로·checksum·파일명은 응답하지 않는다.

```sh
node scripts/audit-opening-runtime.mjs --env /secure/workdeck.env --customer ameaning --assets
node scripts/audit-opening-runtime.mjs --env /secure/workdeck.env --customer peakpay --assets
```

응답의 images/attachments는 checked, verified, manifestMissing, manifestInvalid, readFailed, sizeMismatch, checksumMismatch 집계다. 기준값이 없거나 상충하면 다운로드 전에 분류한다. 중복 객체는 같은 원장 내부에서만 합치므로 고객 전체 고유 객체 수가 아니라 원장별 참조 검사 수다. 이미지의 의도된 압축 변환은 원장 대상 checksum 기준으로 확인하며 현재 원본 S3 파일과의 동일성을 주장하지 않는다.

GET은 운영 Supabase origin에 고정하고 redirect를 거부한다. 각 GET은 5초·20 MiB 스트리밍 상한, 동시 4개·파일 읽기 시작 예산 18초를 사용한다. 요청은 최대 원장 1건·고유 객체 512개이며 전체 Function은 60초다. 예산 초과·네트워크 오류는 readFailed로 남기며 무결성 손상과 구분한다. 누락·실패가 하나라도 있으면 CLI exit 2다. 한 원장 또는 호출 실패로 완주하지 못하면 exit 1이다. 운영 원본 최신 여부·대상 편집 차이·현재 참조의 전체 범위는 별도 대조 결과와 함께 판단한다.
