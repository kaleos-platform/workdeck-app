# 이전 파일의 원장 기준 대조 계획

2026-10-18. 사용자가 남은 작업 검토 후 계속 진행을 요청한 범위다. 파일 내용을 수정하거나 원본 서비스를 종료하지 않는다.

기존 운영 원장 검사 endpoint에 `assets: true`를 추가한다. 로컬로 키·manifest를 내보내는 방식 대신 기존 서버 인증과 고객 allowlist·READ ONLY transaction을 유지한다. 파일 GET은 transaction을 닫은 후 실행하고 응답은 종류별 집계뿐이다. 호출당 원장 1건·고정 페이지 상한으로 순회한다. 객체는 원장 내부에서 중복 제거하며 전체 고객 고유 객체 수로 표현하지 않는다.

- [x] `src/lib/hiring/migration/__tests__/asset-audit.test.ts`에서 실제 checksum, 크기, 누락·상충 manifest, 고객 경로 이탈, 원문 비노출, GET 크기 제한을 먼저 검증한다.
- [x] `src/lib/hiring/migration/asset-audit.ts`에 기존 복구 함수로 검증한 공고의 실제 이미지 블록과 지원서 파일 manifest 추출·읽기 대조를 구현한다. 크기·SHA256 누락은 성공으로 세지 않는다. 무손실 압축본은 원장에 기록한 대상 bytes 기준으로 확인하며 현재 원본 최신 일치를 뜻하지 않는다.
- [x] `app/api/worker/hiring-migration-audit/route.ts`에서 assets 모드를 입력 검증하고 원장 1건씩 반환한다. Storage GET에는 고정 Supabase origin·서비스 인증·redirect 거부·5초 timeout·20 MiB 응답 한도를 적용한다. 읽기 오류와 checksum 불일치를 구분한다.
- [x] `scripts/audit-opening-runtime.mjs`에서 `--assets`를 지원하고 파일 검사 합계·누락 모드·페이지 완주를 검증한다. 오류 또는 미검증 파일이 있으면 exit 2다.
- [ ] 관련 Jest·CLI 테스트, TypeScript·lint·production build, 독립 리뷰와 PR CI를 통과한 정확한 커밋만 배포한다.
- [ ] 운영 배포 확인 후 의식주의·피크페이를 기존 승인된 임시 환경 파일로 호출한다. 결과만 기록하고 인증 파일은 finally에서 삭제한다. 실제 다운로드·SHA256 대조와 원본 최신 파일 동일성을 구분한다.

로컬 검증: Jest 11 suites/177 tests, CLI 5 tests, TypeScript, 전체 lint(오류 0·기존 경고 63), webpack production build 통과. 독립 리뷰에서 Critical/Important 지적 없음. 운영 파일 검사는 배포 후 실행한다.
