-- deck 표시 이름 변경 (id·경로·가격 불변). seed 는 prod 에서 돌지 않으므로 여기서 갱신.
UPDATE "DeckApp" SET name = '쿠팡 채널 관리' WHERE id = 'coupang-ads';
UPDATE "BillingDeckProduct" SET name = '쿠팡 채널 관리' WHERE id = 'coupang-ads';
