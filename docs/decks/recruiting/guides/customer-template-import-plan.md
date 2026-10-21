# 고객 템플릿 이전 계획

2026-10-21. 24개월 정책의 활성 기준정보 예외로 피크페이 고객 템플릿 39건을 준비한다. 공고·지원서는 이미 존재하며 신규 생성하지 않는다. 이 단계는 변환·dry-run 준비이며 운영 데이터/Storage 쓰기는 별도 승인 전 실행하지 않는다.

- 기존 template `sourceRef=opening:detail_template:<id>` 고유 키와 정상 템플릿 데이터/콘텐츠 저장 방식을 재사용한다. 지원서 원장·암호화 키·공통 샘플을 변경하지 않는다.
- 원본 고객·활성 상태·승인된 대상 OWNER·컨텐츠 소속·사용 이미지의 고객 경로와 checksum을 검증한다.
- 본문/편집 이미지 불일치를 각각 보존한다. 원본 지원 링크/빈 지원 링크는 form으로, HTTP 외부 링크는 원문으로 변환한다. 미지원 링크/블록은 보류한다.
- 원본 SVG는 검증 후 PNG로 변환하고 원본/결과 SHA256을 따로 기록한다. PNG/JPEG는 디코딩 검증 후 원본 bytes/MIME을 유지한다. 복사는 기존 checksum 기반 helper와 upsert:false를 사용한다.
- 신규는 transaction으로 템플릿/블록을 함께 생성한다. 같은 sourceRef의 저장된 업무값 projection이 같으면 추가 생성하지 않으며, 다른 고객·샘플·고객 수정이나 저장될 원본 업무값의 변화는 덮어쓰지 않는다. 저장되지 않는 파일 준비 메타데이터까지 동등성을 보장하는 것은 아니므로 실행 시 별도 승인 manifest의 원본/변환 checksum과 원본 row hash도 고정한다. 원본 이름·섹션 data·날짜·대표 이미지와 변환 콘텐츠를 보존한다. 원본 creator ID는 별도 선정 manifest에 보존하고 승인된 OWNER에게 연결한다.
- 단건 CLI는 기본 dry-run이며 실제 적용은 명시적 대상 환경/프로젝트와 --apply를 요구한다. 대상 파일의 bytes를 검사한 뒤 metadata를 쓴다. 실제 고객 자료를 개발 DB로 복사하지 않는다.

## 순서

- [x] 계획/재실행/충돌/범위/링크/미지원 자료/대표 이미지 테스트를 먼저 실패시킨다.
- [x] template planner/importer와 기존 CLI 보호를 재사용한 단건 진입점을 구현한다.
- [x] 실제 39건을 메모리에서 준비하고 source/derived checksum·변환·복사 예정 건수·대상 충돌을 읽기 검증한다.
- [x] 코드 리뷰·관련 테스트·TypeScript·lint를 완료하고 적용 코드와 정확한 dry-run을 보존한다.
- [ ] 신규 템플릿·Storage 쓰기 범위를 구체적으로 제시하고 사용자의 별도 승인을 받은 뒤 적용한다.

## 적용 절차와 중단 조건

실제 자료는 개발 DB에 복사하지 않는다. 준비된 packet은 원본 고객/템플릿 행과 콘텐츠 소속을 확인한 운영 조회 결과에서 메모리로만 생성한다. 최종 승인 manifest는 원본 row hash, 최종 본문/대표 이미지/대상 scope의 `contentHash`, 원본·변환 파일 checksum, 적용 코드 파일 hash를 고정한다. 파일 집합이 같아도 편집 scene의 대응이나 블록 순서가 바뀌면 적용을 중단한다.

1. 승인된 계정의 OWNER 연결과 대상 production project를 다시 확인한다. source `status=1`·고객 소속·명시 범위를 다시 확인한다. 현재 원본/변환 결과가 승인 manifest와 다르면 업로드 전에 중단한다.
2. 최종 블록 또는 대표 이미지가 실제 사용하는 파일만 복사한다. 편집 JSON은 `HiringContent.data`로 저장하며 별도 Storage JSON 파일은 만들지 않는다. 기존 `copyMigrationFile`의 source/target bytes 검증, 결정적 경로, `upsert:false`를 사용한다.
3. 각 packet을 stdin으로 아래 CLI에 전달한다. stdin packet의 원문/scene/이름과 환경변수 내용은 출력하거나 Git에 저장하지 않는다. `source-space`와 `target-space`는 내부 검증 인자이며 제품의 공간 선택 단계를 추가하지 않는다.

```sh
node scripts/import-opening-template.mjs \
  --source-space <source-brand-id> \
  --target-space <approved-existing-space-id> < <secure-packet-file>
```

기본은 계획 출력만 한다. 실제 적용 시에만 아래 인자를 추가한다. 임시 target env는 `MIGRATION_ENVIRONMENT=production-pilot`, 검증된 production URL/DB 연결/Storage 키와 `MIGRATION_CA_FILE`을 포함하고 작업 종료 후 폐기한다. 개발 `.env.local`은 변경하지 않는다.

```sh
--apply --target-mode production-pilot \
  --target-env <temporary-production-env> \
  --expected-project-ref duyteczbadcuvfeawlzu
```

4. CLI는 최종 본문/대표 이미지의 Storage bytes를 다시 확인한 뒤 정상 모델을 transaction으로 생성한다. 기존 자료가 다르면 덮어쓰지 않는다. 중간 오류 시 즉시 중단하며 이미 생성한 템플릿/파일을 자동 삭제하지 않는다. 같은 승인 내용으로 재실행하면 이미 존재하는 파일과 템플릿은 검증 후 재사용한다. 예상하지 않은 고객 템플릿이 추가된 경우 일괄 실행을 중단한다.
5. 적용 후 템플릿 수·sourceRef·블록·지원 링크·Storage checksum을 읽기 검증하고 UI에서 새 공고에 적용되는지 확인한다. 운영 공고 발행·가상 지원 접수·알림 발송은 이 승인에 포함하지 않는다.

## 검증

관련 migration 테스트, TypeScript, lint, webpack build와 독립 코드 리뷰를 수행한다. 개발 합성 자료로 실제 nested create·JSON/날짜 보존·재실행·고객 수정 충돌·OWNER 검증을 확인한 뒤 transaction을 rollback하고 생성 Space/템플릿/블록 잔여 0건을 확인했다. 실제 고객 데이터나 Storage 쓰기를 사용한 검증은 아니다.
