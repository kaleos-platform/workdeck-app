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

export function renderPostingEmbedHtml(params: {
  posting: { uuid: string; contents: ContentBlock[]; positions: PositionData[] }
  origin: string
}): string {
  const { posting, origin } = params
  const parts: string[] = []

  for (const content of posting.contents) {
    if (content.contentType === 'text' && content.data) {
      const html = renderTiptapHtml(content.data)
      if (html) parts.push(`<div style="margin:16px 0">${html}</div>`)
      continue
    }

    if (content.contentType === 'image' || content.contentType === 'design') {
      if (!content.imagePath) continue
      const src = escapeHtml(hiringAssetPublicUrl(content.imagePath))
      parts.push(
        `<img src="${src}" alt="" style="width:100%;height:auto;display:block;margin:16px 0">`
      )
      continue
    }

    if (content.contentType === 'positions') {
      if (posting.positions.length === 0) continue
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
      const btn = content.data as {
        title?: string
        linkType?: string
        url?: string
        color?: string
      } | null
      if (!btn?.title) continue
      const href = btn.linkType === 'url' && btn.url ? btn.url : `${origin}/p/${posting.uuid}/apply`
      const style = buttonBlockStyle(btn.color)
      parts.push(
        `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:block;text-align:center;padding:14px;border-radius:8px;background:${style.backgroundColor};color:${style.color};text-decoration:none;font-weight:600;margin:16px 0">${escapeHtml(btn.title)}</a>`
      )
    }
  }

  return `<div style="max-width:640px;margin:0 auto;font-family:system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif;line-height:1.6;color:#18181b;font-size:15px">${parts.join('')}</div>`
}

function renderRow(label: string, value: string): string {
  return `<div style="display:flex;gap:8px;font-size:13px;margin:2px 0"><span style="color:#71717a;flex-shrink:0">${escapeHtml(label)}</span><span style="font-weight:500">${escapeHtml(value)}</span></div>`
}
