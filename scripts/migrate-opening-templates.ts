/**
 * opening.work 글로벌 샘플 상세템플릿 → workdeck HiringDetailTemplate/HiringContent 이관 (one-off).
 *
 * 소스: opening PostgreSQL (setting.detail_template_samples → detail_template → content).
 * 타깃: workdeck Prisma(HiringDetailTemplate/HiringContent, spaceId=null·isSample) + Supabase Storage(hiring-assets).
 *
 * 실행:
 *   OPENING_ENV_FILE=/path/opening_api.prod.env npx tsx scripts/migrate-opening-templates.ts --dry-run
 *   OPENING_ENV_FILE=/path/opening_api.prod.env npx tsx scripts/migrate-opening-templates.ts            # 실제 이관
 *
 * 옵션:
 *   --dry-run          opening DB만 읽고 리포트 출력 (S3/Supabase/Prisma 쓰기 없음)
 *   --include-custom   custom 섹션을 text 블록으로 실제 이관 (기본: needs-confirm 로 스킵)
 *
 * 멱등: HiringDetailTemplate.sourceRef = `opening:detail_template:<id>` 로 upsert, 기존 contents 교체.
 * 시크릿(DATABASE_URL, service key 등) 값은 stdout 에 절대 출력하지 않는다.
 */
import { config } from 'dotenv'
config({ path: '.env.local', override: false })

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { Client } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Prisma } from '@/generated/prisma/client'

const OPENING_SETTING_KEY = 'detail_template_samples'
const SOURCE_REF_PREFIX = 'opening:detail_template:'
const ASSETS_BUCKET = 'hiring-assets'

// opening DetailSection.type
type SectionType =
  | 'posting_title'
  | 'company_intro'
  | 'posting_positions'
  | 'custom'
  | 'posting_stores'
  | 'manager'
  | 'content'
  | 'content_link'
  | 'image'

type DetailCustomItem = { label?: string; value?: string }
type DetailSection = {
  type: SectionType
  enabled?: boolean
  uuid?: string
  resource_id?: number
  name?: string
  url?: string
  image_key?: string
  items?: DetailCustomItem[]
}

type ContentRow = {
  id: number
  content_type: string
  image_key: string | null
  file_key: string | null
  source_type: string | null
  source_id: number | null
}

type TemplateRow = {
  id: number
  name: string
  image_key: string | null
  data: DetailSection[] | null
  status: number
}

type WdBlockType = 'design' | 'image' | 'positions' | 'text'

// 섹션 처리 결과 — dry-run 리포트와 real-run 실행이 공유하는 계획 단위.
type PlanItem =
  | {
      kind: 'migrate'
      blockType: WdBlockType
      section: DetailSection
      contentRow?: ContentRow
      title: string | null
      // content_link 이관분 — 블록 data 에 지원폼 링크(link.linkType='form')를 병합.
      linkForm?: boolean
    }
  | { kind: 'needs-confirm'; section: DetailSection; note: string } // custom → text (매핑 불확실)
  | { kind: 'skip'; section: DetailSection; reason: string } // 동적 섹션·비활성 등
  | { kind: 'broken'; section: DetailSection; reason: string } // 참조 깨짐(행 없음/키 null)

type TemplatePlan = {
  template: TemplateRow
  sourceRef: string
  coverKey: string | null
  coverMissing: boolean
  histogram: Record<string, number>
  items: PlanItem[]
}

// 템플릿에서 스킵되는 정적/동적 섹션 타입 → 스킵 사유.
const SKIP_TYPES: Partial<Record<SectionType, string>> = {
  posting_title: '공고별 동적 섹션(제목)',
  company_intro: '공고별 동적 섹션(회사소개)',
  posting_stores: '공고별 동적 섹션(근무지)',
  manager: '공고별 동적 섹션(담당자)',
}

// ─── opening env 로드 (시크릿 — 값 출력 금지) ────────────────────────────────
function loadOpeningEnv(): Record<string, string> {
  const path = process.env.OPENING_ENV_FILE
  if (!path) throw new Error('OPENING_ENV_FILE 환경변수가 필요합니다 (opening env 파일 경로)')
  const txt = readFileSync(path, 'utf8')
  const env: Record<string, string> = {}
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    env[m[1]] = v
  }
  return env
}

// ─── custom → Tiptap doc (needs-confirm 매핑 후보) ───────────────────────────
function buildTextDoc(items: DetailCustomItem[]): unknown {
  const content: unknown[] = []
  for (const it of items) {
    const label = (it.label ?? '').trim()
    const value = (it.value ?? '').trim()
    if (label) {
      content.push({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: label }],
      })
    }
    if (value) {
      for (const line of value.split('\n')) {
        content.push(
          line
            ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
            : { type: 'paragraph' }
        )
      }
    }
  }
  return { type: 'doc', content }
}

// ─── opening DB 조회 (읽기 전용) ─────────────────────────────────────────────
async function loadFromOpening(env: Record<string, string>): Promise<{
  templates: TemplateRow[]
  contentById: Map<number, ContentRow>
}> {
  const conn = env.DATABASE_URL
  if (!conn) throw new Error('opening env 에 DATABASE_URL 이 없습니다')
  const useSsl = !/sslmode=disable/.test(conn)
  const client = new Client({
    connectionString: conn,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  })
  await client.connect()
  try {
    // 1) 샘플 템플릿 id 목록 (setting, ACTIVE=1)
    const settingRes = await client.query(
      `SELECT setting_value FROM setting WHERE setting_key = $1 AND status = 1 LIMIT 1`,
      [OPENING_SETTING_KEY]
    )
    if (settingRes.rows.length === 0)
      throw new Error('detail_template_samples setting 을 찾을 수 없습니다')
    let raw = settingRes.rows[0].setting_value
    if (typeof raw === 'string') raw = JSON.parse(raw)
    const sampleIds: number[] = (Array.isArray(raw) ? raw : [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n))
    if (sampleIds.length === 0) throw new Error('detail_template_samples 가 비어 있습니다')

    // 2) 템플릿 행 (setting 순서 보존)
    const tplRes = await client.query<TemplateRow>(
      `SELECT id, name, image_key, data, status FROM detail_template WHERE id = ANY($1::bigint[])`,
      [sampleIds]
    )
    const tplById = new Map<number, TemplateRow>()
    for (const r of tplRes.rows) tplById.set(Number(r.id), { ...r, id: Number(r.id) })
    const templates = sampleIds
      .map((id) => tplById.get(id))
      .filter((t): t is TemplateRow => Boolean(t))

    // 3) content/content_link 섹션이 참조하는 content 행 (ACTIVE=1)
    const resourceIds = new Set<number>()
    for (const t of templates) {
      for (const s of t.data ?? []) {
        if ((s.type === 'content' || s.type === 'content_link') && s.resource_id) {
          resourceIds.add(Number(s.resource_id))
        }
      }
    }
    const contentById = new Map<number, ContentRow>()
    if (resourceIds.size > 0) {
      const contentRes = await client.query<ContentRow>(
        `SELECT id, content_type, image_key, file_key, source_type, source_id
           FROM content WHERE id = ANY($1::bigint[]) AND status = 1`,
        [[...resourceIds]]
      )
      for (const r of contentRes.rows) contentById.set(Number(r.id), { ...r, id: Number(r.id) })
    }
    return { templates, contentById }
  } finally {
    await client.end()
  }
}

// ─── 템플릿별 이관 계획 수립 (DB 데이터만 사용, 부작용 없음) ──────────────────
function planTemplate(
  template: TemplateRow,
  contentById: Map<number, ContentRow>,
  includeCustom: boolean
): TemplatePlan {
  const items: PlanItem[] = []
  const histogram: Record<string, number> = {}
  for (const section of template.data ?? []) {
    histogram[section.type] = (histogram[section.type] ?? 0) + 1
    const title = section.name?.trim() ? section.name.trim() : null

    if (section.enabled === false) {
      items.push({ kind: 'skip', section, reason: '비활성(enabled=false)' })
      continue
    }

    switch (section.type) {
      case 'content': {
        const row = section.resource_id ? contentById.get(Number(section.resource_id)) : undefined
        if (!row) {
          items.push({
            kind: 'broken',
            section,
            reason: `content 행 없음/비활성 (resource_id=${section.resource_id ?? '없음'})`,
          })
        } else if (!row.file_key || !row.image_key) {
          items.push({
            kind: 'broken',
            section,
            reason: `content id=${row.id} S3 키 null (file_key=${row.file_key ? 'ok' : 'null'}, image_key=${row.image_key ? 'ok' : 'null'})`,
          })
        } else {
          items.push({ kind: 'migrate', blockType: 'design', section, contentRow: row, title })
        }
        break
      }
      case 'content_link': {
        // 링크 카드 → design 블록: scene(file_key) 복원 + 지원폼 링크(link.linkType='form') + PNG(image_key).
        // scene 없으면(file_key null) image 블록으로 폴백하되 지원폼 링크는 유지.
        const row = section.resource_id ? contentById.get(Number(section.resource_id)) : undefined
        if (!row) {
          items.push({
            kind: 'broken',
            section,
            reason: `content_link 행 없음/비활성 (resource_id=${section.resource_id ?? '없음'})`,
          })
        } else if (!row.image_key) {
          items.push({
            kind: 'broken',
            section,
            reason: `content_link content id=${row.id} image_key null`,
          })
        } else if (row.file_key) {
          items.push({
            kind: 'migrate',
            blockType: 'design',
            section,
            contentRow: row,
            title,
            linkForm: true,
          })
        } else {
          items.push({
            kind: 'migrate',
            blockType: 'image',
            section,
            contentRow: row,
            title,
            linkForm: true,
          })
        }
        break
      }
      case 'image': {
        if (!section.image_key) {
          items.push({ kind: 'broken', section, reason: 'image 섹션 image_key null' })
        } else {
          items.push({ kind: 'migrate', blockType: 'image', section, title })
        }
        break
      }
      case 'posting_positions': {
        items.push({ kind: 'migrate', blockType: 'positions', section, title })
        break
      }
      case 'custom': {
        const has = (section.items ?? []).some(
          (i) => (i.label ?? '').trim() || (i.value ?? '').trim()
        )
        if (!has) {
          items.push({ kind: 'skip', section, reason: 'custom 섹션 내용 없음' })
        } else if (includeCustom) {
          items.push({ kind: 'migrate', blockType: 'text', section, title })
        } else {
          items.push({
            kind: 'needs-confirm',
            section,
            note: 'custom → text(Tiptap) 매핑 확인 필요',
          })
        }
        break
      }
      default: {
        const reason = SKIP_TYPES[section.type] ?? `미지원 섹션 타입(${section.type})`
        items.push({ kind: 'skip', section, reason })
      }
    }
  }
  return {
    template,
    sourceRef: `${SOURCE_REF_PREFIX}${template.id}`,
    coverKey: template.image_key,
    coverMissing: !template.image_key,
    histogram,
    items,
  }
}

// ─── real-run: S3 다운로드 + Supabase 업로드 ─────────────────────────────────
function s3Download(bucket: string, key: string): Buffer {
  return execFileSync('aws', ['--profile', 'peak', 's3', 'cp', `s3://${bucket}/${key}`, '-'], {
    maxBuffer: 64 * 1024 * 1024,
  })
}

function makeSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !serviceKey)
    throw new Error('Supabase 환경변수(service role)가 없습니다 (.env.local)')
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

async function uploadPng(sb: SupabaseClient, storagePath: string, data: Buffer): Promise<string> {
  const { error } = await sb.storage
    .from(ASSETS_BUCKET)
    .upload(storagePath, data, { contentType: 'image/png', upsert: true })
  if (error) throw new Error(`Supabase 업로드 실패(${storagePath}): ${error.message}`)
  return storagePath
}

async function runMigration(plans: TemplatePlan[], env: Record<string, string>) {
  const { prisma } = await import('@/lib/prisma')
  const sb = makeSupabase()
  const publicBucket = env.S3_PUBLIC_FILE_BUCKET
  const privateBucket = env.S3_PRIVATE_FILE_BUCKET
  if (!publicBucket || !privateBucket) throw new Error('opening env 에 S3 버킷 설정이 없습니다')

  let ok = 0
  const failures: { id: number; name: string; error: string }[] = []

  for (const plan of plans) {
    const { template, sourceRef } = plan
    try {
      const base = `samples/${template.id}`

      // 커버 이미지 (public bucket → hiring-assets)
      let coverPath: string | null = null
      if (plan.coverKey) {
        coverPath = await uploadPng(
          sb,
          `${base}/cover.png`,
          s3Download(publicBucket, plan.coverKey)
        )
      }

      // 블록 빌드 (업로드/씬 다운로드는 트랜잭션 밖)
      const blocks: {
        contentType: WdBlockType
        title: string | null
        data: unknown | null
        imagePath: string | null
      }[] = []
      for (const item of plan.items) {
        if (item.kind !== 'migrate') continue
        if (item.blockType === 'design') {
          const row = item.contentRow!
          const scene = JSON.parse(s3Download(privateBucket, row.file_key!).toString('utf8'))
          // content_link 이관분은 scene 최상위에 지원폼 링크를 병합(F1 design 링크 스키마와 동일).
          const data = item.linkForm ? { ...scene, link: { linkType: 'form' } } : scene
          const imagePath = await uploadPng(
            sb,
            `${base}/${row.id}.png`,
            s3Download(publicBucket, row.image_key!)
          )
          blocks.push({ contentType: 'design', title: item.title, data, imagePath })
        } else if (item.blockType === 'image') {
          // content_link 은 content 행의 image_key 사용, image 섹션은 섹션 자체 image_key.
          const imageKey = item.contentRow?.image_key ?? item.section.image_key!
          const name = item.contentRow
            ? `link-${item.contentRow.id}`
            : `img-${item.section.uuid ?? blocks.length}`
          const imagePath = await uploadPng(
            sb,
            `${base}/${name}.png`,
            s3Download(publicBucket, imageKey)
          )
          // content_link 폴백(scene 없음)은 image data 에 지원폼 링크만 저장.
          const data = item.linkForm ? { link: { linkType: 'form' } } : null
          blocks.push({ contentType: 'image', title: item.title, data, imagePath })
        } else if (item.blockType === 'positions') {
          blocks.push({ contentType: 'positions', title: item.title, data: null, imagePath: null })
        } else if (item.blockType === 'text') {
          blocks.push({
            contentType: 'text',
            title: item.title,
            data: buildTextDoc(item.section.items ?? []),
            imagePath: null,
          })
        }
      }

      await prisma.$transaction(async (tx) => {
        const tmpl = await tx.hiringDetailTemplate.upsert({
          where: { sourceRef },
          create: {
            spaceId: null,
            name: template.name,
            isSample: true,
            imagePath: coverPath,
            sourceRef,
          },
          update: { name: template.name, imagePath: coverPath },
        })
        await tx.hiringContent.deleteMany({
          where: { templateId: tmpl.id, sourceType: 'DETAIL_TEMPLATE' },
        })
        if (blocks.length > 0) {
          await tx.hiringContent.createMany({
            data: blocks.map((b, i) => ({
              spaceId: null,
              sourceType: 'DETAIL_TEMPLATE' as const,
              templateId: tmpl.id,
              contentType: b.contentType,
              title: b.title,
              data: (b.data ?? undefined) as Prisma.InputJsonValue | undefined,
              imagePath: b.imagePath,
              sortOrder: i,
            })),
          })
        }
      })
      ok++
      console.log(`  ✓ [${template.id}] ${template.name} — 블록 ${blocks.length}개`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures.push({ id: template.id, name: template.name, error: msg })
      console.error(`  ✗ [${template.id}] ${template.name} — 실패: ${msg}`)
    }
  }

  await prisma.$disconnect()
  console.log(`\n[실행 요약] 성공 ${ok} · 실패 ${failures.length}`)
  if (failures.length > 0) {
    for (const f of failures) console.log(`  실패 [${f.id}] ${f.name}: ${f.error}`)
  }
}

// ─── dry-run 리포트 ──────────────────────────────────────────────────────────
function printReport(plans: TemplatePlan[], includeCustom: boolean) {
  const line = '─'.repeat(72)
  console.log(`\n${line}\nopening 샘플 상세템플릿 → workdeck 이관 · DRY-RUN 리포트\n${line}`)
  console.log(`샘플 템플릿 수: ${plans.length}`)

  let totalMigrate = 0
  let totalSkip = 0
  let totalNeedsConfirm = 0
  const totalBroken: string[] = []
  const migrateByType: Record<string, number> = {}

  for (const plan of plans) {
    const { template } = plan
    const migrate = plan.items.filter((i) => i.kind === 'migrate')
    const skip = plan.items.filter((i) => i.kind === 'skip')
    const needs = plan.items.filter((i) => i.kind === 'needs-confirm')
    const broken = plan.items.filter((i) => i.kind === 'broken')
    totalMigrate += migrate.length
    totalSkip += skip.length
    totalNeedsConfirm += needs.length
    for (const m of migrate)
      if (m.kind === 'migrate') migrateByType[m.blockType] = (migrateByType[m.blockType] ?? 0) + 1

    console.log(`\n■ [${template.id}] ${template.name}`)
    console.log(`  sourceRef: ${plan.sourceRef}`)
    console.log(
      `  커버 이미지: ${plan.coverMissing ? '없음(image_key null → imagePath=null)' : '있음'}`
    )
    const hist = Object.entries(plan.histogram)
      .map(([k, v]) => `${k}×${v}`)
      .join(', ')
    console.log(`  섹션 히스토그램: ${hist || '(없음)'}`)
    console.log(
      `  → 이관 블록 ${migrate.length}개` +
        (migrate.length
          ? ` (${migrate.map((m) => (m.kind === 'migrate' ? m.blockType : '')).join(', ')})`
          : '')
    )
    if (needs.length) console.log(`  → needs-confirm ${needs.length}개 (custom→text)`)
    if (skip.length) {
      const reasons = skip
        .map((s) => (s.kind === 'skip' ? s.reason : ''))
        .reduce<Record<string, number>>((a, r) => {
          a[r] = (a[r] ?? 0) + 1
          return a
        }, {})
      console.log(
        `  → 스킵 ${skip.length}개: ${Object.entries(reasons)
          .map(([r, c]) => `${r}×${c}`)
          .join('; ')}`
      )
    }
    for (const b of broken) {
      if (b.kind === 'broken') {
        const label = `[${template.id}] ${template.name} :: ${b.reason}`
        totalBroken.push(label)
        console.log(`  ⚠ 참조 깨짐: ${b.reason}`)
      }
    }
  }

  console.log(`\n${line}\n합계\n${line}`)
  console.log(
    `이관 예정 블록: ${totalMigrate}개  (${
      Object.entries(migrateByType)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || '없음'
    })`
  )
  console.log(
    `needs-confirm(custom→text): ${totalNeedsConfirm}개  ${includeCustom ? '(--include-custom 로 이관 대상에 포함됨)' : '(기본 스킵 — 확인 후 --include-custom)'}`
  )
  console.log(`스킵 예정 섹션: ${totalSkip}개  (동적/비활성/미지원)`)
  console.log(`참조 깨진 content: ${totalBroken.length}개`)
  for (const b of totalBroken) console.log(`  - ${b}`)
  console.log(line)
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const includeCustom = args.includes('--include-custom')

  const openingEnv = loadOpeningEnv()
  const { templates, contentById } = await loadFromOpening(openingEnv)
  const plans = templates.map((t) => planTemplate(t, contentById, includeCustom))

  if (dryRun) {
    printReport(plans, includeCustom)
    console.log('\n[dry-run] 변경 없이 종료 — S3/Supabase/Prisma 쓰기 없음')
    return
  }

  console.log('[실행] opening 자산 다운로드 → Supabase 업로드 → Prisma 이관 시작')
  await runMigration(plans, openingEnv)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
