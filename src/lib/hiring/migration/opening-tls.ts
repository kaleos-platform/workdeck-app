export function openingTlsConfig(connectionString: string, ca?: string) {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw Error('UNSAFE_DATABASE_URL')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname)
    throw Error('UNSAFE_DATABASE_URL')
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase()
    if (normalized.startsWith('ssl') || ['uselibpqcompat', 'host', 'hostaddr'].includes(normalized))
      throw Error('UNSAFE_DATABASE_URL')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  return {
    connectionString,
    ssl: {
      rejectUnauthorized: true,
      checkServerIdentity: (_host: string, cert: Parameters<typeof checkServerIdentity>[1]) =>
        checkServerIdentity(hostname, cert),
      ...(ca !== undefined ? { ca } : {}),
    },
  }
}
import { checkServerIdentity } from 'node:tls'

