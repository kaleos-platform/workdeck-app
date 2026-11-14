// 메일 공용 레이아웃(A안 카드) — 연회색 바탕 + 흰 카드 + 카드 밖 하단 안내.
// 메일 클라이언트 호환: 테이블 레이아웃 + 인라인 스타일만 쓴다(외부 폰트·JS·이미지 없음).
// <style> 은 다크 모드(Apple Mail 등)·모바일 폭 보정용이고, 무시돼도 라이트 화면이 그대로 읽힌다.
// 색은 메일 전용 인라인 hex 다(DESIGN.md §8 결정 기록). 모든 텍스트 인자는 여기서 escape 한다.
// server-only 를 넣지 않는다 — Supabase 인증 메일 템플릿 생성(supabase-templates.ts)에서도 쓴다.

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Outlook 데스크톱은 글꼴을 상속하지 않아 글자 칸마다 직접 넣는다(맑은 고딕이 없으면 명조로 떨어진다)
const FONT =
  "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif"
const COLOR = {
  text: '#18181b',
  muted: '#71717a',
  line: '#e4e4e7',
  soft: '#f4f4f5',
  // 마케팅 헤더 로고(blue-600)와 같은 값
  brand: '#2563eb',
}

const font = (style: string) => `font-family:${FONT};${style}`

const DARK_STYLE = `<style>
@media (max-width:600px){.px{padding-left:20px!important;padding-right:20px!important}.wrap{padding:16px 8px!important}}
@media (prefers-color-scheme:dark){body,.outer{background-color:#09090b!important}.card{background-color:#18181b!important;border-color:#3f3f46!important}.info{background-color:#27272a!important}.t{color:#fafafa!important}.m{color:#a1a1aa!important}.ln{border-color:#3f3f46!important}.btn{background-color:#fafafa!important}.btnt{color:#18181b!important}.lk{color:#60a5fa!important}}
</style>`

/** 이미지 없는 로고 — 이미지 차단 메일함에서도 보인다 */
function workdeckHeader(label?: string) {
  const sub = label
    ? `<span class="m" style="font-weight:400;color:${COLOR.muted};"> · ${escapeHtml(label)}</span>`
    : ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="${COLOR.brand}" style="width:22px;height:22px;background-color:${COLOR.brand};border-radius:5px;text-align:center;vertical-align:middle;${font('font-size:13px;font-weight:700;color:#ffffff;line-height:22px;')}">W</td><td class="t" style="padding-left:8px;${font(`font-size:15px;font-weight:700;color:${COLOR.text};`)}">Workdeck${sub}</td></tr></table>`
}

/** 고객사(워크스페이스) 이름이 주인공인 헤더 — 지원자 대상 메일 */
function spaceHeader(name: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="t" style="${font(`font-size:16px;font-weight:700;color:${COLOR.text};word-break:break-all;`)}">${escapeHtml(name)}</td></tr></table>`
}

export const emailBlocks = {
  heading: (text: string) =>
    `<h1 class="t" style="margin:0 0 12px 0;${font(`font-size:20px;line-height:1.4;font-weight:700;color:${COLOR.text};word-break:keep-all;`)}">${escapeHtml(text)}</h1>`,

  paragraph: (text: string, opts: { muted?: boolean } = {}) =>
    `<p class="${opts.muted ? 'm' : 't'}" style="margin:0 0 12px 0;${font(`font-size:14px;line-height:1.7;color:${opts.muted ? COLOR.muted : COLOR.text};word-break:keep-all;`)}">${escapeHtml(text)}</p>`,

  /** 라벨-값 회색 상자(공고·접수 시각 등) */
  details: (rows: Array<[string, string]>) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.soft}" class="info" style="background-color:${COLOR.soft};border-radius:6px;margin:8px 0 20px 0;"><tr><td style="padding:16px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows
      .map(
        ([label, value]) =>
          `<tr><td width="72" valign="top" class="m" style="padding:2px 0;${font(`font-size:13px;color:${COLOR.muted};`)}">${escapeHtml(label)}</td><td class="t" style="padding:2px 0;${font(`font-size:13px;color:${COLOR.text};word-break:break-all;`)}">${escapeHtml(value)}</td></tr>`
      )
      .join('')}</table></td></tr></table>`,

  /** 구분선 목록 — 왼쪽 제목, 오른쪽 값. 둘 다 같은 링크 */
  linkRows: (items: Array<{ label: string; value: string; url: string }>) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ln" style="margin:4px 0 24px 0;border-top:1px solid ${COLOR.line};border-bottom:1px solid ${COLOR.line};">${items
      .map((item, i) => {
        const top = i ? `border-top:1px solid ${COLOR.line};` : ''
        const href = escapeHtml(item.url)
        return `<tr><td class="ln" style="padding:12px 0;${top}${font('font-size:14px;line-height:1.5;word-break:break-all;')}"><a href="${href}" class="t" style="color:${COLOR.text};text-decoration:none;font-weight:600;">${escapeHtml(item.label)}</a></td><td align="right" valign="top" class="ln" style="padding:12px 0 12px 12px;white-space:nowrap;${top}${font('font-size:14px;')}"><a href="${href}" class="lk" style="color:${COLOR.brand};text-decoration:none;font-weight:600;">${escapeHtml(item.value)} &rsaquo;</a></td></tr>`
      })
      .join('')}</table>`,

  /** Outlook 은 a 의 padding·radius 를 버려서 배경색 td 로 감싼다 */
  button: (label: string, url: string) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0 0;"><tr><td bgcolor="${COLOR.text}" class="btn" style="background-color:${COLOR.text};border-radius:6px;mso-padding-alt:11px 18px;"><a href="${escapeHtml(url)}" class="btnt" style="display:inline-block;padding:11px 18px;${font('font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;')}">${escapeHtml(label)}</a></td></tr></table>`,

  /** 버튼이 안 눌리는 클라이언트용 원문 주소 */
  fallbackLink: (url: string) =>
    `<p class="m" style="margin:20px 0 0 0;${font(`font-size:12px;line-height:1.6;color:${COLOR.muted};`)}">버튼이 열리지 않으면 아래 주소를 브라우저에 붙여 넣으세요.<br><a href="${escapeHtml(url)}" class="lk" style="color:${COLOR.brand};word-break:break-all;">${escapeHtml(url)}</a></p>`,
}

export type EmailHeader = { kind: 'workdeck'; label?: string } | { kind: 'space'; name: string }

export function renderEmail(input: {
  /** 메일 목록 미리보기 문구(본문에는 안 보임) */
  preheader: string
  header: EmailHeader
  /** emailBlocks 로 만든 HTML 조각 */
  body: string[]
  /** 카드 밖 하단 안내 — 줄 단위 텍스트 */
  footer: string[]
}): string {
  const header =
    input.header.kind === 'space'
      ? spaceHeader(input.header.name)
      : workdeckHeader(input.header.label)
  const footer = input.footer.map(escapeHtml).join('<br>')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">${DARK_STYLE}</head><body style="margin:0;padding:0;background-color:${COLOR.soft};"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLOR.soft};">${escapeHtml(input.preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.soft}" class="outer" style="background-color:${COLOR.soft};"><tr><td align="center" class="wrap" style="padding:32px 16px;"><!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" class="card" style="background-color:#ffffff;border:1px solid ${COLOR.line};border-radius:8px;"><tr><td class="px" style="padding:24px 32px 0 32px;">${header}</td></tr><tr><td class="px" style="padding:20px 32px 32px 32px;">${input.body.join('')}</td></tr></table></td></tr><tr><td class="m px" style="padding:20px 32px 0 32px;${font(`font-size:12px;line-height:1.6;color:${COLOR.muted};word-break:keep-all;`)}">${footer}</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`
}
