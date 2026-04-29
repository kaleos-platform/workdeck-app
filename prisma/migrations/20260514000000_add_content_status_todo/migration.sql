-- AlterEnum
-- PostgreSQL의 ALTER TYPE ... ADD VALUE는 트랜잭션 밖에서 실행되어야 함
ALTER TYPE "ContentStatus" ADD VALUE 'TODO' BEFORE 'DRAFT';
