import { z } from 'zod'

// ─── 섹션 구조 ──────────────────────────────────────────────────────────────
// Template.sections 는 kind 에 따라 형태가 다르다:
//   BLOG / SOCIAL: { sections: TemplateSection[] }
//   CARDNEWS    : { slides: TemplateSlide[] }  (각 slide 는 자체 sections 배열)

export const templateSectionConstraintsSchema = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    required: z.boolean().optional(),
    aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).optional(),
  })
  .strict()
  .optional()

export const templateSectionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'key 는 영문/숫자/밑줄만'),
  kind: z.enum(['text', 'imageSlot', 'cta']),
  label: z.string().min(1).max(80),
  guidance: z.string().max(1000).optional(),
  constraints: templateSectionConstraintsSchema,
})
export type TemplateSection = z.infer<typeof templateSectionSchema>

export const templateSlideSchema = z.object({
  index: z.number().int().min(0).max(19), // 최대 20 슬라이드
  sections: z.array(templateSectionSchema).min(1).max(8),
})
export type TemplateSlide = z.infer<typeof templateSlideSchema>

export const blogSocialSectionsSchema = z.object({
  sections: z.array(templateSectionSchema).min(1).max(30),
})

export const cardnewsSectionsSchema = z.object({
  slides: z.array(templateSlideSchema).min(1).max(20),
})

export type TemplateSectionsShape =
  | z.infer<typeof blogSocialSectionsSchema>
  | z.infer<typeof cardnewsSectionsSchema>

// kind 에 맞는 zod 스키마 선택
export function sectionsSchemaForKind(kind: 'BLOG' | 'SOCIAL' | 'CARDNEWS') {
  return kind === 'CARDNEWS' ? cardnewsSectionsSchema : blogSocialSectionsSchema
}

// ─── Skeleton 렌더 ──────────────────────────────────────────────────────────
// Unit 6 TipTap 에디터에 넘길 기본 Doc 구조를 생성한다. 아직 TipTap 은 설치 전이라
// 순수 JSON Doc 스펙만 조립해서 반환한다.

export interface ContentSkeletonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: ContentSkeletonNode[]
  text?: string
}

export interface ContentSkeletonResult {
  doc: ContentSkeletonNode
  slotMap: { key: string; nodeIndex: number; kind: 'text' | 'imageSlot' | 'cta' }[]
}

// 1개 섹션을 TipTap-like node 로 변환.
function sectionToNode(section: TemplateSection): ContentSkeletonNode {
  if (section.kind === 'imageSlot') {
    return {
      type: 'imageSlot',
      attrs: { key: section.key, label: section.label, placeholder: section.guidance ?? null },
    }
  }
  if (section.kind === 'cta') {
    return {
      type: 'ctaSlot',
      attrs: { key: section.key, label: section.label, url: null, text: section.label },
    }
  }
  // text
  return {
    type: 'paragraph',
    attrs: { key: section.key, label: section.label },
    content: [],
  }
}

export function renderSkeleton(
  kind: 'BLOG' | 'SOCIAL' | 'CARDNEWS',
  sections: TemplateSectionsShape
): ContentSkeletonResult {
  const children: ContentSkeletonNode[] = []
  const slotMap: ContentSkeletonResult['slotMap'] = []

  if (kind === 'CARDNEWS') {
    const parsed = cardnewsSectionsSchema.parse(sections)
    parsed.slides
      .slice()
      .sort((a, b) => a.index - b.index)
      .forEach((slide) => {
        const slideChildren: ContentSkeletonNode[] = slide.sections.map((s, i) => {
          const n = sectionToNode(s)
          slotMap.push({
            key: `slide_${slide.index}_${s.key}`,
            nodeIndex: children.length + i,
            kind: s.kind,
          })
          return n
        })
        children.push({
          type: 'slide',
          attrs: { index: slide.index },
          content: slideChildren,
        })
      })
  } else {
    const parsed = blogSocialSectionsSchema.parse(sections)
    parsed.sections.forEach((s, i) => {
      const n = sectionToNode(s)
      slotMap.push({ key: s.key, nodeIndex: i, kind: s.kind })
      children.push(n)
    })
  }

  return {
    doc: { type: 'doc', content: children },
    slotMap,
  }
}

// ─── 시스템 템플릿 ──────────────────────────────────────────────────────────

export const SYSTEM_TEMPLATES: Array<{
  slug: string
  name: string
  kind: 'BLOG' | 'SOCIAL' | 'CARDNEWS'
  sections: TemplateSectionsShape
}> = [
  {
    slug: 'system-blog-long',
    name: '블로그 장문',
    kind: 'BLOG',
    sections: {
      sections: [
        {
          key: 'title',
          kind: 'text',
          label: '제목',
          constraints: { maxLength: 80, required: true },
        },
        {
          key: 'lead',
          kind: 'text',
          label: '도입 (훅)',
          guidance: '독자의 문제를 한 문장으로 선언',
        },
        { key: 'h2_problem', kind: 'text', label: 'H2 — 문제 제기' },
        { key: 'body_problem', kind: 'text', label: '문제 본문' },
        {
          key: 'image1',
          kind: 'imageSlot',
          label: '대표 이미지',
          constraints: { aspectRatio: '16:9' },
        },
        { key: 'h2_solution', kind: 'text', label: 'H2 — 해결책' },
        { key: 'body_solution', kind: 'text', label: '해결책 본문' },
        { key: 'h2_proof', kind: 'text', label: 'H2 — 증빙/사례' },
        { key: 'body_proof', kind: 'text', label: '증빙 본문' },
        { key: 'cta', kind: 'cta', label: '행동 유도' },
      ],
    },
  },
  {
    slug: 'system-social-short',
    name: '소셜 텍스트',
    kind: 'SOCIAL',
    sections: {
      sections: [
        {
          key: 'hook',
          kind: 'text',
          label: '훅 (1-2문장)',
          constraints: { maxLength: 200, required: true },
        },
        { key: 'body', kind: 'text', label: '본문', constraints: { maxLength: 500 } },
        { key: 'image', kind: 'imageSlot', label: '이미지', constraints: { aspectRatio: '1:1' } },
        { key: 'cta', kind: 'cta', label: '행동 유도' },
      ],
    },
  },
  {
    slug: 'system-cardnews',
    name: '카드뉴스 (5장)',
    kind: 'CARDNEWS',
    sections: {
      slides: [
        {
          index: 0,
          sections: [
            { key: 'title', kind: 'text', label: '표지 제목', constraints: { required: true } },
            {
              key: 'image',
              kind: 'imageSlot',
              label: '표지 이미지',
              constraints: { aspectRatio: '1:1' },
            },
          ],
        },
        ...[1, 2, 3].map<TemplateSlide>((i) => ({
          index: i,
          sections: [
            { key: 'caption', kind: 'text', label: `카피 ${i}`, constraints: { maxLength: 120 } },
            {
              key: 'image',
              kind: 'imageSlot',
              label: `이미지 ${i}`,
              constraints: { aspectRatio: '1:1' },
            },
          ],
        })),
        {
          index: 4,
          sections: [
            { key: 'summary', kind: 'text', label: '요약' },
            { key: 'cta', kind: 'cta', label: '행동 유도' },
          ],
        },
      ],
    },
  },
]
