import { z } from 'zod'

// ─── AI 응답 구조 스키마 ─────────────────────────────────────────────────────

// 소구점 항목 — AI가 생성하는 하나의 소구점
export const appealPointItemSchema = z.object({
  point: z.string().min(1).max(300), // 소구점 한 줄 정의
  evidence: z.string().min(1).max(500), // 근거 / 데이터
  targetPain: z.string().min(1).max(300), // 타겟의 페인 포인트
  priority: z.number().int().min(1).max(5), // 우선순위 (1=최우선)
})

export type AppealPointItem = z.infer<typeof appealPointItemSchema>

// 아웃라인 섹션 항목
export const outlineSectionSchema = z.object({
  section: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
})

// 블로그 소재 항목 — AI가 생성하는 하나의 소재 후보
export const boMaterialItemSchema = z.object({
  title: z.string().min(1).max(200),
  appealPoint: z.string().min(1).max(300), // 어떤 소구점을 다루는지 (단순 문자열)
  angle: z.string().min(1).max(400), // 콘텐츠 접근 관점
  outline: z.array(outlineSectionSchema).min(1).max(10),
  targetKeyword: z.string().max(100).optional(),
})

export type BoMaterialItem = z.infer<typeof boMaterialItemSchema>

// AI 전체 응답 스키마 — 넓게 허용 (모델이 약간 벗어나도 재시도 방지)
export const boIdeationResponseSchema = z.object({
  appealPoints: z.array(appealPointItemSchema).min(1).max(15),
  materials: z.array(boMaterialItemSchema).min(1).max(15),
})

export type BoIdeationResponse = z.infer<typeof boIdeationResponseSchema>

// ─── API 요청 스키마 ─────────────────────────────────────────────────────────

export const runBoIdeationBodySchema = z.object({
  productId: z.string().min(1),
  userPromptInput: z.string().max(2000).optional(),
})

// 소재 수동 등록
export const createBoMaterialBodySchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1).max(200),
  appealPoint: z.string().min(1).max(300),
  angle: z.string().min(1).max(400),
  outline: z.array(outlineSectionSchema).default([]),
  targetKeyword: z.string().max(100).optional(),
  ideationId: z.string().optional(),
})

// 소재 PATCH (편집 + 상태 전환)
export const patchBoMaterialBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  appealPoint: z.string().min(1).max(300).optional(),
  angle: z.string().min(1).max(400).optional(),
  outline: z.array(outlineSectionSchema).optional(),
  targetKeyword: z.string().max(100).optional(),
  status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED', 'ARCHIVED']).optional(),
})
