# 카페24 다중 쇼핑몰 연결

화면: 설정 > 연동 > 카페24 팝업(`cafe24-connect-card`), 판매채널 편집 > 주문정보 탭(`channel-order-observe-section`). 미리보기: `wireframe.html` / `wireframe.png`. 계획: `docs/superpowers/plans/2026-11-21-cafe24-multimall.md`

1. 단일 쇼핑몰 요약 카드 → 쇼핑몰 목록 표(ID·상태·승인일·행별 승인/다시 승인·삭제).
2. 쇼핑몰별 최근 오류는 그 행 아래 한 줄.
3. 「쇼핑몰 추가」: 쇼핑몰 ID만 입력(앱 정보는 저장된 것 재사용). 최대 5개, 개수 표시.
4. 「앱 정보 수정」: client_id/secret 1회 입력, 모든 쇼핑몰에 적용. 첫 추가 때는 ③에 함께 표시.
5. 주문정보 탭: 가져올 곳=카페24이면 연결된 쇼핑몰 Select. 쇼핑몰당 채널 1개.
