// 소셜 게시용 평문 추출 + CTA URL 말미 부착.

import { exportBlogMarkdown, type BlogExportInput } from './blog-markdown'

export interface SocialExportInput extends BlogExportInput {
  maxChars?: number // 플랫폼별 제한
}

export function exportSocialText(input: SocialExportInput): string {
  // MD 로 뽑은 뒤 기호 정리.
  const md = exportBlogMarkdown(input)
  const plain = md
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/!\[.*?\]\((.*?)\)/g, '') // 이미지는 별도 첨부로
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 $2')
    .replace(/^#+\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // CTA URL 이 이미 포함되지 않았다면 말미에.
  const withCta = plain.includes(input.deploymentUrl) ? plain : `${plain}\n\n${input.deploymentUrl}`

  if (input.maxChars && withCta.length > input.maxChars) {
    const reserved = input.deploymentUrl.length + 4
    return `${withCta.slice(0, input.maxChars - reserved - 1)}…\n${input.deploymentUrl}`
  }
  return withCta
}
