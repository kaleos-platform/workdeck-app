# Space·업무 구독 현황 통합

승인된 방향: Space 상위 행 + 펼칠 수 있는 업무 하위 행. 별도 전체 Space 면제 영역을 제거한다. 업무가 없어도 Space·소유자·전체 면제를 표시하며, 전체 면제와 업무별 저장값·상속을 구분한다. DB schema와 체험·청구 정책은 변경하지 않는다.

- [x] GET 응답의 spaces에 이미 조회한 OWNER 정보를 포함하고 업무 없는 Space 회귀 테스트 추가.
- [x] 단일 table에서 Space별 tbody 그룹, 접근 가능한 펼치기 버튼과 전체 펼치기/접기 제공.
- [x] 검색은 Space·소유자, 업무·상태는 자식 행에 적용. 업무 필터가 없으면 업무 없는 Space도 검색 가능. 필터 변경 시 일치 그룹 자동 펼치기, 수량은 Space와 업무를 별도 표시.
- [x] 전체 면제 dialog에 필터와 무관하게 해당 Space의 모든 업무에 적용함을 안내. 기존 업무 면제·연장 endpoint와 사유 검증 재사용.
- [x] collapsed·filter·empty Space·owner·scope·상속·연장 회귀 검증 후 typecheck/lint/build.
- [x] 합성 데이터 실제 컴포넌트 Chromium 1440px/390px 표시·스크롤·그룹·연장 검증.
- [ ] 독립 spec/code review 후 기존 승인된 검증→develop→main 배포 흐름으로 반영.

검증: 관련 Jest 3 suites / 37 tests, typecheck·build 통과. 전체 lint error 0, 기존 warning 65개. 실제 컴포넌트의 합성 데이터 Chromium 검증(1440px/390px)에서 접기/펼치기·빈 Space·문서 overflow 없음·표 내부 스크롤·KST +30일·필수 사유·단일 PATCH·dialog 종료를 확인했다. 독립 spec/code review에 추가 P1/P2 finding 없음. 운영 고객 데이터를 시험 변경하지 않았다.
