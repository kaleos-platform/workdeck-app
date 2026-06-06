-- CoupangBackfillStatus 에 CANCELLED 추가 (백필 잡 중간 취소용)
ALTER TYPE "CoupangBackfillStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
