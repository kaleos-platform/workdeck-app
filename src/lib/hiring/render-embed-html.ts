// 공고 상세를 외부 사이트에 붙여넣을 수 있는 자치 HTML 문자열로 렌더 (서버 전용).
// 전부 inline style 사용 — 대상 사이트의 class 충돌을 피하기 위함.
import { renderTiptapHtml } from '@/lib/hiring/render-tiptap'
import {
  JOB_TYPE_LABELS,
  formatPay,
  formatWorkDays,
  formatWorkTime,
  hiringAssetPublicUrl,
} from '@/components/hiring-public/posting-labels'
import { buttonBlockStyle } from '@/lib/hiring/button-color'
import { blockLinkSchema, buttonDataSchema } from '@/lib/validations/hiring-posts'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type ContentBlock = {
  contentType: 'image' | 'text' | 'button' | 'positions' | 'design'
  data: unknown
  imagePath: string | null
}

type PositionData = {
  name: string
  jobType: string | null
  payFrequency: string | null
  payAmount: number | null
  workDays: unknown
  workStartAt: string | null
  workEndAt: string | null
  headcount: number | null
  experience: string | null
  education: string | null
  jobDescription: string | null
}

export type PostingEmbedIssue = {
  blockNumber: number
  severity: 'error' | 'warning'
  message: string
}

type EmbedParams = {
  posting: { uuid: string; contents: ContentBlock[]; positions: PositionData[] }
  origin: string
}

function validUrl(value: unknown, protocols = ['http:', 'https:']): boolean {
  if (typeof value !== 'string') return false
  try {
    return protocols.includes(new URL(value).protocol)
  } catch {
    return false
  }
}

// 레거시 문서의 링크도 출력 시 검사한다. 외부 사이트에서는 상대 URL을 사용할 수 없다.
function hasInvalidTextUrl(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const node = value as {
    type?: string
    attrs?: { href?: unknown; src?: unknown }
    content?: unknown[]
    marks?: unknown[]
  }
  if (node.type === 'link' && !validUrl(node.attrs?.href, ['http:', 'https:', 'mailto:', 'tel:']))
    return true
  if (node.type === 'image' && !validUrl(node.attrs?.src)) return true
  return (
    (Array.isArray(node.content) && node.content.some(hasInvalidTextUrl)) ||
    (Array.isArray(node.marks) && node.marks.some(hasInvalidTextUrl))
  )
}

export function renderPostingEmbed({ posting, origin }: EmbedParams): {
  html: string
  issues: PostingEmbedIssue[]
  usesFormLink: boolean
} {
  const parts: string[] = []
  const issues: PostingEmbedIssue[] = []
  let usesFormLink = false

  for (const [index, content] of posting.contents.entries()) {
    const issue = (message: string, severity: PostingEmbedIssue['severity'] = 'error') => {
      issues.push({ blockNumber: index + 1, severity, message })
    }
    if (content.contentType === 'text') {
      if (!content.data) {
        issue('텍스트가 비어 있어 출력에서 제외됩니다.', 'warning')
        continue
      }
      if (hasInvalidTextUrl(content.data)) {
        issue(
          '텍스트의 링크 또는 이미지 주소를 확인하세요. 외부에서 접근 가능한 전체 주소가 필요합니다.'
        )
        continue
      }
      const html = renderTiptapHtml(content.data, true)
      if (html) parts.push(`<div style="margin:16px 0">${html}</div>`)
      else
        issue('텍스트를 HTML로 변환하지 못했습니다. 내용을 다시 편집하거나 이 카드를 삭제하세요.')
      continue
    }

    if (content.contentType === 'image' || content.contentType === 'design') {
      if (!content.imagePath) {
        issue(
          content.contentType === 'design'
            ? '디자인 이미지가 저장되지 않았습니다. 카드저장을 완료하세요.'
            : '이미지가 저장되지 않았습니다. 이미지를 업로드하세요.'
        )
        continue
      }
      const imageUrl = hiringAssetPublicUrl(content.imagePath)
      if (!validUrl(imageUrl)) {
        issue('공개 이미지 주소를 만들지 못했습니다. 이미지 설정을 확인하세요.')
        continue
      }
      const src = escapeHtml(imageUrl)
      const rawLink = (content.data as { link?: unknown } | null)?.link
      const parsed = blockLinkSchema.safeParse(rawLink ?? { linkType: 'none' })
      if (!parsed.success) {
        issue('이미지 링크가 올바르지 않습니다. http 또는 https 전체 주소를 입력하세요.')
        continue
      }
      const link = parsed.data
      if (link.linkType === 'form') usesFormLink = true
      const href =
        link.linkType === 'form'
          ? `${origin}/p/${posting.uuid}/apply`
          : link.linkType === 'url'
            ? link.url
            : null
      const img = `<img src="${src}" alt="" style="width:100%;height:auto;display:block">`
      if (href) {
        parts.push(
          `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:block;margin:16px 0">${img}</a>`
        )
      } else {
        parts.push(
          `<img src="${src}" alt="" style="width:100%;height:auto;display:block;margin:16px 0">`
        )
      }
      continue
    }

    if (content.contentType === 'positions') {
      if (posting.positions.length === 0) {
        issue('등록된 직무가 없어 직무 정보가 출력에서 제외됩니다.', 'warning')
        continue
      }
      for (const p of posting.positions) {
        const rows: string[] = []
        rows.push(renderRow('급여', formatPay(p.payFrequency, p.payAmount)))
        const workDays = formatWorkDays(p.workDays)
        if (workDays) rows.push(renderRow('근무 요일', workDays))
        const workTime = formatWorkTime(p.workStartAt, p.workEndAt)
        if (workTime) rows.push(renderRow('근무 시간', workTime))
        if (p.experience) rows.push(renderRow('경력', p.experience))
        if (p.education) rows.push(renderRow('학력', p.education))

        const jobTypeLabel = p.jobType ? (JOB_TYPE_LABELS[p.jobType] ?? p.jobType) : null
        const jobDescriptionHtml = p.jobDescription
          ? `<p style="margin:12px 0 0;white-space:pre-wrap;font-size:13px;color:#52525b">${escapeHtml(p.jobDescription)}</p>`
          : ''

        parts.push(
          `<div style="border:1px solid #e4e4e7;border-radius:8px;padding:16px;margin:12px 0">` +
            `<div style="font-weight:600;margin-bottom:8px">${escapeHtml(p.name)}${jobTypeLabel ? ` · ${escapeHtml(jobTypeLabel)}` : ''}</div>` +
            `<div>${rows.join('')}</div>` +
            jobDescriptionHtml +
            `</div>`
        )
      }
      continue
    }

    if (content.contentType === 'button') {
      const parsed = buttonDataSchema.safeParse(content.data)
      if (!parsed.success || !parsed.data.title.trim()) {
        issue(
          '버튼의 문구와 연결 주소를 확인하세요. 외부 링크는 http 또는 https 전체 주소가 필요합니다.'
        )
        continue
      }
      const btn = parsed.data
      if (btn.linkType === 'form') usesFormLink = true
      const href = btn.linkType === 'url' ? btn.url! : `${origin}/p/${posting.uuid}/apply`
      const style = buttonBlockStyle(btn.color)
      parts.push(
        `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:block;text-align:center;padding:14px;border-radius:8px;background:${style.backgroundColor};color:${style.color};text-decoration:none;font-weight:600;margin:16px 0">${escapeHtml(btn.title)}</a>`
      )
      continue
    }
    issue('지원하지 않는 카드 형식입니다. 내용을 확인하고 다시 작성하세요.')
  }

  if (parts.length === 0)
    issues.push({
      blockNumber: 0,
      severity: 'error',
      message: '복사할 공고 내용이 없습니다. 내용을 작성하고 저장하세요.',
    })
  const html = `<div style="max-width:640px;margin:0 auto;font-family:system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif;line-height:1.6;color:#18181b;font-size:15px">${parts.join('')}</div>`
  return { html, issues, usesFormLink }
}

export function renderPostingEmbedHtml(params: EmbedParams): string {
  return renderPostingEmbed(params).html
}

function renderRow(label: string, value: string): string {
  return `<div style="display:flex;gap:8px;font-size:13px;margin:2px 0"><span style="color:#71717a;flex-shrink:0">${escapeHtml(label)}</span><span style="font-weight:500">${escapeHtml(value)}</span></div>`
}
