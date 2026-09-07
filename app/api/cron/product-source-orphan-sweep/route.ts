import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron/with-cron-run'
import { PRODUCT_SOURCE_BUCKET, removeProductSourceFiles } from '@/lib/sh/product-source-storage'

export const runtime = 'nodejs'

/** 참조 없이 방치된 파일로 볼 최소 나이(일). 방금 업로드하고 아직 [AI로 추출]을 누르지 않은
 *  사용자의 파일을 지우지 않기 위한 유예 기간. */
const TTL_DAYS = Number(process.env.PRODUCT_SOURCE_ORPHAN_TTL_DAYS ?? 7)

/** 한 회차 최대 삭제 건수 — 말없이 잘라내지 않도록 응답에 truncated 플래그로 드러낸다. */
const MAX_DELETE_PER_RUN = 500

/** Supabase Storage list()의 기본 페이지 크기(100) — 끝까지 순회하기 위한 명시적 페이지네이션. */
const LIST_PAGE_SIZE = 100

/** ProductExtractionSource.storagePath IN 조회 청크 크기 */
const DB_LOOKUP_CHUNK_SIZE = 200

type StorageListItem = {
  name: string
  id: string | null
  created_at: string | null
}

let cachedClient: SupabaseClient | null = null

function serviceClient(): SupabaseClient {
  if (cachedClient) return cachedClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase 환경변수(service role)가 설정되지 않았습니다')
  cachedClient = createClient(url, key, { auth: { persistSession: false } })
  return cachedClient
}

/** 폴더 항목은 id/created_at이 null로 온다(dev 버킷 실측 확인). 파일 항목만 id를 갖는다. */
function isFolder(item: StorageListItem): boolean {
  return item.id === null
}

/** limit/offset으로 끝까지 페이지네이션한다 — list()는 기본 100건만 반환한다. */
async function listAll(supabase: SupabaseClient, path: string): Promise<StorageListItem[]> {
  const out: StorageListItem[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage
      .from(PRODUCT_SOURCE_BUCKET)
      .list(path, { limit: LIST_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`Storage list 실패(${path}): ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as StorageListItem[]))
    if (data.length < LIST_PAGE_SIZE) break
    offset += LIST_PAGE_SIZE
  }
  return out
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * GET /api/cron/product-source-orphan-sweep — Vercel cron 호출 전용.
 *
 * 상품 소재 파일(product-source-files 버킷)은 업로드(파일 저장)와 Job 생성(DB row)이
 * 별도 단계로 이루어진다. 업로드만 하고 [AI로 추출]을 누르지 않으면 파일이 참조 없이
 * 버킷에 영원히 남는다. 조직이 Supabase Free 플랜(스토리지 총량 1GB)이라 방치하면
 * 한도에 닿는다.
 *
 * 경로 규칙: {spaceId}/products/{productId}/{uuid}.{ext}
 * ProductExtractionSource.storagePath 에 참조가 없고, TTL_DAYS보다 오래된 파일만 삭제한다.
 */
export const GET = withCronRun('/api/cron/product-source-orphan-sweep', async () => {
  const supabase = serviceClient()
  const cutoffMs = Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000

  let scanned = 0
  let malformed = 0
  const candidates: { path: string; createdAtMs: number }[] = []

  const spaceEntries = await listAll(supabase, '')
  for (const spaceEntry of spaceEntries) {
    if (!isFolder(spaceEntry)) {
      malformed++
      continue
    }
    const spaceId = spaceEntry.name

    const spaceChildren = await listAll(supabase, spaceId)
    for (const child of spaceChildren) {
      if (!isFolder(child) || child.name !== 'products') {
        malformed++
        continue
      }

      const productEntries = await listAll(supabase, `${spaceId}/products`)
      for (const productEntry of productEntries) {
        if (!isFolder(productEntry)) {
          malformed++
          continue
        }
        const productId = productEntry.name

        const fileEntries = await listAll(supabase, `${spaceId}/products/${productId}`)
        for (const fileEntry of fileEntries) {
          if (isFolder(fileEntry) || !fileEntry.created_at) {
            malformed++
            continue
          }
          scanned++
          candidates.push({
            path: `${spaceId}/products/${productId}/${fileEntry.name}`,
            createdAtMs: new Date(fileEntry.created_at).getTime(),
          })
        }
      }
    }
  }

  const oldEnough = candidates.filter((c) => c.createdAtMs < cutoffMs)
  const skippedRecent = candidates.length - oldEnough.length

  const referenced = new Set<string>()
  for (const pathsChunk of chunk(
    oldEnough.map((c) => c.path),
    DB_LOOKUP_CHUNK_SIZE
  )) {
    if (pathsChunk.length === 0) continue
    const rows = await prisma.productExtractionSource.findMany({
      where: { storagePath: { in: pathsChunk } },
      select: { storagePath: true },
    })
    for (const row of rows) {
      if (row.storagePath) referenced.add(row.storagePath)
    }
  }

  const orphanPaths = oldEnough.filter((c) => !referenced.has(c.path)).map((c) => c.path)
  const truncated = orphanPaths.length > MAX_DELETE_PER_RUN
  const toDelete = truncated ? orphanPaths.slice(0, MAX_DELETE_PER_RUN) : orphanPaths

  if (toDelete.length > 0) {
    await removeProductSourceFiles(toDelete)
  }

  return {
    scanned,
    orphans: orphanPaths.length,
    deleted: toDelete.length,
    skippedRecent,
    malformed,
    truncated,
  }
})
