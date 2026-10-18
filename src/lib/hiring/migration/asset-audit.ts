import { createHash } from 'node:crypto'
import type { HiringMigrationRecord } from '@/generated/prisma/client'
import { recoverOpeningPosting } from './posting-recovery'
import { recoverOpeningApplication } from './application-recovery'
import { planPostingContent } from './posting-content'

type Bucket = 'hiring-assets' | 'hiring-files'
export type AuditAsset = { bucket: Bucket; path: string; sizeBytes?: number; sha256?: string }
const maxBytes = 20 * 1024 * 1024
const safePath = (path: string) =>
  /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(path) &&
  !path.split('/').some((part) => part === '.' || part === '..')
const empty = () => ({
  checked: 0,
  verified: 0,
  manifestMissing: 0,
  manifestInvalid: 0,
  readFailed: 0,
  sizeMismatch: 0,
  checksumMismatch: 0,
})

export function migrationAssetManifest(
  record: HiringMigrationRecord,
  scope: { spaceId: string; sourceSpaceId: string }
): AuditAsset[] {
  if (record.targetModel === 'HiringApplication')
    return recoverOpeningApplication(record, scope).files.map((file) => ({
      bucket: 'hiring-files',
      path: file.path,
      sizeBytes: file.bytes,
      sha256: file.sha256,
    }))
  if (record.targetModel !== 'HiringPosting') return []
  const { packet } = recoverOpeningPosting(record, scope)
  const planned = planPostingContent(packet.content)
  if (!planned.ok) throw Error('ASSET_MANIFEST_FAILED')
  const candidates = [
    ...Object.values(packet.content.resources),
    ...Object.values(packet.content.images),
    ...(packet.content.detailImage ? [packet.content.detailImage] : []),
  ]
  return [
    ...new Set(planned.blocks.flatMap((block) => (block.imagePath ? [block.imagePath] : []))),
  ].flatMap((path) => {
    const matches = candidates.filter((asset) => asset.copiedImagePath === path)
    return matches.length
      ? matches.map((asset) => ({
          bucket: 'hiring-assets' as const,
          path,
          sizeBytes: asset.sizeBytes,
          sha256: asset.sha256,
        }))
      : [{ bucket: 'hiring-assets' as const, path }]
  })
}

export async function auditAssetManifest(
  entries: AuditAsset[],
  spaceId: string,
  read: (bucket: Bucket, path: string) => Promise<Uint8Array>
) {
  const result = { images: empty(), attachments: empty() }
  const groups = new Map<string, AuditAsset[]>()
  for (const entry of entries) {
    const key = `${entry.bucket}:${entry.path}`
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  if (groups.size > 512) throw Error('ASSET_MANIFEST_LIMIT')
  const deadline = Date.now() + 18000
  const groupsArray = [...groups.values()]
  for (let i = 0; i < groupsArray.length; i += 4) {
    await Promise.all(
      groupsArray.slice(i, i + 4).map(async (group) => {
        const entry = group[0]
        const stats = entry.bucket === 'hiring-assets' ? result.images : result.attachments
        stats.checked++
        if (
          !['hiring-assets', 'hiring-files'].includes(entry.bucket) ||
          !safePath(entry.path) ||
          !entry.path.startsWith(`${spaceId}/`) ||
          group.some(
            (other) => other.sha256 !== entry.sha256 || other.sizeBytes !== entry.sizeBytes
          )
        ) {
          stats.manifestInvalid++
          return
        }
        if (entry.sha256 === undefined || entry.sizeBytes === undefined) {
          stats.manifestMissing++
          return
        }
        if (
          !/^[a-f0-9]{64}$/.test(entry.sha256) ||
          !Number.isSafeInteger(entry.sizeBytes) ||
          entry.sizeBytes < 1 ||
          entry.sizeBytes > maxBytes
        ) {
          stats.manifestInvalid++
          return
        }
        try {
          if (Date.now() >= deadline) throw Error('ASSET_READ_FAILED')
          const bytes = await read(entry.bucket, entry.path)
          if (bytes.byteLength !== entry.sizeBytes) stats.sizeMismatch++
          else if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
            stats.checksumMismatch++
          else stats.verified++
        } catch {
          stats.readFailed++
        }
      })
    )
  }
  return result
}

export async function readMigrationAsset(bucket: Bucket, path: string): Promise<Uint8Array> {
  try {
    if (!['hiring-assets', 'hiring-files'].includes(bucket) || !safePath(path)) throw Error()
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
    if (
      origin.protocol !== 'https:' ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password ||
      !key
    )
      throw Error()
    const response = await fetch(
      `${origin.origin}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'GET',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      }
    )
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get('content-length') ?? 0) > maxBytes
    ) {
      await response.body?.cancel()
      throw Error()
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > maxBytes) throw Error()
        chunks.push(part.value)
      }
    } finally {
      await reader.cancel()
    }
    return Buffer.concat(chunks)
  } catch {
    throw Error('ASSET_READ_FAILED')
  }
}
