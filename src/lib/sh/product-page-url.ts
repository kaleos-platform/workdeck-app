// 상품 페이지 URL → 판매채널 추정. 순수 함수만 둔다.

export interface ChannelForUrlDetect {
  id: string
  name: string
  storeUrl: string | null
  externalSource: string | null
  isActive: boolean
}

export function normalizeHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

const bareHost = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '')
const trimPath = (p: string) => p.replace(/\/+$/, '')

// 호스트 접미사 → 채널명 키워드 (storeUrl 미설정 채널용 폴백)
const MARKETPLACES: Array<{ hosts: string[]; keywords: string[] }> = [
  { hosts: ['coupang.com'], keywords: ['쿠팡'] },
  { hosts: ['smartstore.naver.com', 'brand.naver.com'], keywords: ['스마트스토어', '네이버'] },
]

export function detectChannelForUrl(
  url: string,
  channels: ChannelForUrlDetect[]
): { channelId: string | null; candidates: Array<{ id: string; name: string }> } {
  const target = normalizeHttpUrl(url)
  if (!target) return { channelId: null, candidates: [] }
  // 연동 채널은 대표 채널을 미러링하므로 리스팅 대상이 아니다.
  const usable = channels.filter((c) => c.isActive && c.externalSource == null)
  const host = bareHost(target)
  const path = trimPath(target.pathname)

  let best = -1
  let matched: ChannelForUrlDetect[] = []
  for (const c of usable) {
    const store = c.storeUrl ? normalizeHttpUrl(c.storeUrl) : null
    if (!store || bareHost(store) !== host) continue
    const sp = trimPath(store.pathname)
    if (sp !== '' && path !== sp && !path.startsWith(sp + '/')) continue
    if (sp.length > best) {
      best = sp.length
      matched = [c]
    } else if (sp.length === best) matched.push(c)
  }

  if (matched.length === 0) {
    const mp = MARKETPLACES.find((m) => m.hosts.some((h) => host === h || host.endsWith('.' + h)))
    if (mp) matched = usable.filter((c) => mp.keywords.some((k) => c.name.includes(k)))
  }

  return {
    channelId: matched.length === 1 ? matched[0].id : null,
    candidates: matched.map((c) => ({ id: c.id, name: c.name })),
  }
}
