import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { TemplateSectionsShape } from '@/lib/sc/template-engine'
import { blogSocialSectionsSchema, cardnewsSectionsSchema } from '@/lib/sc/template-engine'

type Props = {
  kind: 'BLOG' | 'SOCIAL' | 'CARDNEWS'
  sections: unknown
}

const KIND_BADGE: Record<'text' | 'imageSlot' | 'cta', string> = {
  text: '텍스트',
  imageSlot: '이미지',
  cta: 'CTA',
}

export function TemplatePreview({ kind, sections }: Props) {
  const shape = safeParse(kind, sections)
  if (!shape) {
    return (
      <p className="text-sm text-destructive">
        sections 구조가 올바르지 않아 미리보기가 비어 있습니다.
      </p>
    )
  }

  if (kind === 'CARDNEWS') {
    const s = shape as { slides: { index: number; sections: Section[] }[] }
    return (
      <div className="space-y-3">
        {s.slides
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((slide) => (
            <Card key={slide.index}>
              <CardContent className="space-y-2 p-4">
                <p className="text-xs font-semibold text-muted-foreground">
                  슬라이드 {slide.index + 1}
                </p>
                <SectionRows sections={slide.sections} />
              </CardContent>
            </Card>
          ))}
      </div>
    )
  }

  const s = shape as { sections: Section[] }
  return (
    <Card>
      <CardContent className="p-4">
        <SectionRows sections={s.sections} />
      </CardContent>
    </Card>
  )
}

type Section = {
  key: string
  kind: 'text' | 'imageSlot' | 'cta'
  label: string
  guidance?: string
  constraints?: { maxLength?: number; aspectRatio?: string; required?: boolean }
}

function SectionRows({ sections }: { sections: Section[] }) {
  return (
    <div className="divide-y">
      {sections.map((s) => (
        <div key={s.key} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {KIND_BADGE[s.kind]}
              </Badge>
              <span className="text-sm font-medium">{s.label}</span>
              {s.constraints?.required && <span className="text-xs text-destructive">*</span>}
            </div>
            {s.guidance && <p className="mt-1 text-xs text-muted-foreground">{s.guidance}</p>}
          </div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            {s.constraints?.maxLength && <span>최대 {s.constraints.maxLength}자</span>}
            {s.constraints?.aspectRatio && <span>비율 {s.constraints.aspectRatio}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function safeParse(
  kind: 'BLOG' | 'SOCIAL' | 'CARDNEWS',
  sections: unknown
): TemplateSectionsShape | null {
  const parsed =
    kind === 'CARDNEWS'
      ? cardnewsSectionsSchema.safeParse(sections)
      : blogSocialSectionsSchema.safeParse(sections)
  return parsed.success ? parsed.data : null
}
