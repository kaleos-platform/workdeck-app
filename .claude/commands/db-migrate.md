# .claude/commands/db/migrate.md

---

description: "Prisma 스키마 변경 후 마이그레이션을 생성하고 적용합니다"
allowed-tools:
[
"Bash(npx prisma:*)",
"Bash(npx prisma migrate:*)",
"Bash(npx prisma db:*)",
"Bash(npx prisma generate:*)",
"Read",
]

---

# Prisma 마이그레이션

스키마 변경사항을 분석하고 마이그레이션을 생성합니다.

## 프로세스

1. prisma/schema.prisma 파일 확인
2. 현재 DB 상태와 스키마 차이 분석
3. 마이그레이션 이름 제안 (한국어 설명)
4. `prisma migrate dev` 실행
5. Prisma Client 재생성
