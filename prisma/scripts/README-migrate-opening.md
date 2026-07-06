# opening.work → workdeck 채용 데이터 이관 가이드

opening.work 의 단일 테넌트(brand) 채용 데이터를 workdeck HiringXxx 모델로 이관하는 1회성 스크립트.
고객별 opt-in 방식으로 수동 실행한다.

---

## 필수 환경변수

`.env.local` 에 아래 변수를 추가한다.

| 변수명 | 설명 |
|---|---|
| `OPENING_DATABASE_URL` | opening Postgres 연결 문자열 (읽기 전용 권한으로 충분) |
| `OPENING_SECRET_KEY` | opening AES-256-CBC 키 (hex 인코딩, 64자 = 32바이트) |
| `OPENING_HMAC_KEY` | opening HMAC-SHA256 키 (원문 문자열) |
| `ENCRYPTION_KEY` | workdeck AES-256-CBC 키 (hex 인코딩, 64자) |
| `HIRING_HMAC_KEY` | workdeck HMAC-SHA256 키 (hex 인코딩, 최소 64자) |
| `DATABASE_URL` / `DIRECT_URL` | workdeck Postgres 연결 문자열 (기존 변수 그대로) |

---

## 실행 순서

### 1. 사전 확인

- workdeck 에 대상 `spaceId` 가 존재하고, hiring DeckInstance 가 활성화되어 있어야 한다.
- opening `brandId` 는 opening DB `brand` 테이블의 `id` 값이다.

### 2. Dry-run (실제 쓰기 없음)

```bash
npx tsx prisma/scripts/migrate-opening.ts \
  --brand <openingBrandId> \
  --space <workdeckSpaceId> \
  --dry-run
```

출력에서 이관될 건수와 샘플 항목을 확인한다.

### 3. 실제 이관

```bash
npx tsx prisma/scripts/migrate-opening.ts \
  --brand <openingBrandId> \
  --space <workdeckSpaceId>
```

기본값으로 오늘 기준 최근 365일 데이터를 이관한다.
날짜 범위를 지정하려면 `--since` 옵션을 사용한다.

```bash
npx tsx prisma/scripts/migrate-opening.ts \
  --brand 123 \
  --space clxxx \
  --since 2024-01-01
```

### 4. 재실행 (멱등성)

동일 인자로 재실행해도 중복 데이터가 생기지 않는다.

- **공고(posting)**: `uuid` 로 upsert
- **지원서(application)**: opening `application.id` 로부터 생성된 결정론적 UUID (uuidv5) 로 upsert
- **매장/직무**: `(spaceId, name)` 으로 조회 후 upsert
- **블랙리스트**: `(spaceId, phoneHash)` 로 조회 후 upsert
- **메시지 템플릿**: `(spaceId, title)` 로 조회 후 upsert

---

## 이관 대상 엔티티

| opening | workdeck | 비고 |
|---|---|---|
| store | HiringStore | address 테이블 JOIN — road_address / detail / zipcode |
| position | HiringPosition | category_name 스냅샷 |
| posting | HiringPosting | uuid 재사용(idempotency 앵커), PII 재암호화 |
| posting_position | HiringPostingPosition | JOB_TYPE / PAY_FREQUENCY enum 변환 |
| posting_store | HiringPostingStore | 조인 테이블 |
| application | HiringApplication | PII decrypt(opening 키)→re-encrypt(workdeck 키), 결정론적 UUID |
| comment (source_type=application) | HiringComment | member_id → userId 문자열 (아래 주의사항 참고) |
| blacklist | HiringBlacklist | phone decrypt→re-encrypt + hash |
| message_template | HiringMessageTemplate | ACTIVE 상태만 |

---

## 이관하지 않는 항목 및 이유

| 항목 | 이유 |
|---|---|
| 파일(File / S3 객체) | S3 → Supabase Storage 복사는 별도 opening S3 크리덴셜 + 스토리지 이관 작업이 필요. 메타데이터 행만 이관해도 실제 파일이 없으면 broken link. 별도 단계로 분리. |
| Boosting / RPA 데이터 | opening 전용 외부 플랫폼 연동이며 workdeck 에 대응 모델 없음 |
| 결제(PaySubscription / PayCustomer) | Steppay 구독 데이터 — workdeck 결제 체계와 상이 |
| 알림(Alimtalk) | 발송 이력 — workdeck 알림 시스템과 구조 상이 |
| ApplicationNotification | 30일 만료 토큰 기반 — 이관 시점에 대부분 만료됨 |

---

## 주의사항

### comment.userId

opening `comment.member_id` 는 opening 자체 Member PK 이며, workdeck Supabase user id 와 **일치하지 않는다**.
이관된 HiringComment 의 `userId` 는 `"12345"` (문자열 숫자) 형태이므로, 화면 표시 시 "이관된 댓글" 여부를 구분하는 UI 처리를 별도로 고려해야 한다.

### PII 암호화 키 관리

- 이관 후 `OPENING_SECRET_KEY` 와 `OPENING_HMAC_KEY` 는 .env.local 에서 제거한다.
- workdeck 측 PII 는 `ENCRYPTION_KEY` / `HIRING_HMAC_KEY` 로 암호화된다.

### opening 암호화 포맷

opening `_enc` 컬럼은 `base64ciphertext|hexiv` 포맷이다 (AES-256-CBC).
opening `OPENING_SECRET_KEY` 는 hex 인코딩된 원시 키 바이트다.
