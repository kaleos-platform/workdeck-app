/** @jest-environment node */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildSupabaseTemplates } from '../supabase-templates'

const DIR = path.join(process.cwd(), 'docs/email/auth-templates')

describe('Supabase 인증 메일 템플릿', () => {
  const templates = buildSupabaseTemplates()

  if (process.env.UPDATE_EMAIL_TEMPLATES) {
    mkdirSync(DIR, { recursive: true })
    for (const t of templates) writeFileSync(path.join(DIR, `${t.key}.html`), t.html)
  }

  it.each(templates)('$key 파일이 정의와 같다', (t) => {
    const file = path.join(DIR, `${t.key}.html`)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(t.html)
  })

  it('GoTrue 변수를 깨뜨리지 않는다', () => {
    const byKey = Object.fromEntries(templates.map((t) => [t.key, t.html]))
    expect(byKey.confirmation).toContain('href="{{ .ConfirmationURL }}"')
    expect(byKey.invite).toContain(
      'href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite&amp;next={{ .Data.invite_path }}"'
    )
    expect(byKey.email_change).toContain('{{ .Email }} → {{ .NewEmail }}')
  })
})
