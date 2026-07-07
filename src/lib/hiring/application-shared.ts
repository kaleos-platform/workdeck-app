/**
 * 지원 도메인 공유 상수·타입 — 클라이언트 안전(client-safe) 모듈.
 * 서버 전용 의존성(prisma/crypto/storage)을 절대 import 하지 않는다.
 * 클라이언트 컴포넌트는 applications.ts 가 아니라 이 모듈에서 가져올 것.
 */
import type {
  HiringApplicationStage,
  HiringProcessStage,
  HiringNotificationType,
} from '@/generated/prisma/client'

// ─── 라벨 맵(한국어 표시) ────────────────────────────────────────────────────

export const STAGE_LABELS: Record<HiringApplicationStage, string> = {
  HIRING: '진행 중',
  ACCEPTED: '합격',
  REJECTED: '불합격',
}

export const PROCESS_STAGE_LABELS: Record<HiringProcessStage, string> = {
  APPLIED: '서류 접수',
  INTERVIEW: '면접',
  JOB_OFFER: '최종 제안',
}

export const NOTIFICATION_LABELS: Record<HiringNotificationType, string> = {
  INTERVIEW: '면접 안내',
  JOB_OFFER: '처우 협의',
  ACCEPTED: '합격 안내',
  REJECTED: '불합격 안내',
}

// ─── 목록 행 타입 (서버 조회 결과 → 클라이언트 테이블) ───────────────────────

export type ApplicationListRow = {
  id: string
  maskedName: string
  postingTitle: string
  stage: HiringApplicationStage
  hiringStage: HiringProcessStage
  createdAt: string
  duplicated: boolean
  blacklisted: boolean
}
