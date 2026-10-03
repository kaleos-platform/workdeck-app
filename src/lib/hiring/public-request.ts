import { hashIp } from '@/lib/sc/utm'

export function publicRequestKey(req: Pick<Request, 'headers'>): string {
  const vercel = req.headers.get('x-vercel-forwarded-for')
  const forwarded = req.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const ip =
    vercel?.split(',')[0]?.trim() || forwarded?.at(-1) || req.headers.get('x-real-ip') || 'unknown'
  try {
    return ip === 'unknown' ? 'unknown' : hashIp(ip)
  } catch {
    return 'unknown'
  }
}
