// 고객 콘텐츠의 구조만 집계한다. 원문·ID·파일 키와 예외 원문은 출력하지 않는다.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'
import pg from 'pg'
import { parseScope } from './audit-opening-migration.mjs'

const types = [
  'posting_title',
  'company_intro',
  'posting_positions',
  'custom',
  'posting_stores',
  'manager',
  'content',
  'content_link',
  'image',
]
const attributes = new Set([
  'type',
  'enabled',
  'uuid',
  'resource_id',
  'name',
  'url',
  'image_key',
  'file_key',
  'image_url',
  'image_download_url',
  'items',
])
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const keyPresent = (value) => typeof value === 'string' && value.trim().length > 0
function id(value) {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
    ? value
    : null
}
function validUrl(value) {
  if (typeof value !== 'string' || value.trim() !== value || !/^https?:\/\//i.test(value))
    return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
function group(rows, field) {
  const map = new Map()
  for (const row of rows) map.set(row[field], [...(map.get(row[field]) ?? []), row])
  return map
}

export function summarizeOpeningContent(rows, resources, files) {
  const byResource = group(resources, 'id')
  const byFile = group(files, 'file_key')
  const report = {
    total: rows.length,
    plannedStructural: 0,
    blocked: 0,
    assetVerificationPending: 0,
    disabledSections: 0,
    wholeDetailImages: 0,
    sceneReferences: 0,
    sectionFileKeyOccurrences: 0,
    sectionFileKeyStale: 0,
    imageReferences: 0,
    sectionTypes: Object.fromEntries(types.map((type) => [type, 0])),
    reasons: {},
  }
  for (const posting of rows) {
    const reasons = new Set()
    let assets = 0
    const requireFile = (key, targetTypes) => {
      assets++
      if (!keyPresent(key)) {
        reasons.add('missing_image_key')
        return
      }
      const candidates = byFile.get(key) ?? []
      if (candidates.length !== 1) {
        reasons.add(candidates.length ? 'ambiguous_file' : 'missing_file')
        return
      }
      const file = candidates[0]
      if (file.status !== 1) reasons.add('inactive_file')
      if (!targetTypes.includes(file.target_type)) reasons.add('file_target_mismatch')
      if (file.storage_type !== 's3' || !keyPresent(file.storage))
        reasons.add('unknown_file_storage')
    }
    if (!id(posting.id) || !id(posting.brand_id)) reasons.add('invalid_posting_identity')
    if (posting.detail_image_key !== '' && posting.detail_image_key !== null) {
      report.wholeDetailImages++
      report.imageReferences++
      requireFile(posting.detail_image_key, ['posting_detail_img'])
    }
    if (!Array.isArray(posting.detail)) reasons.add('invalid_detail')
    for (const section of Array.isArray(posting.detail) ? posting.detail : []) {
      if (
        !record(section) ||
        (section.enabled !== undefined && typeof section.enabled !== 'boolean')
      ) {
        reasons.add('invalid_section')
        continue
      }
      if (!section.enabled) {
        report.disabledSections++
        continue
      }
      if (!types.includes(section.type)) {
        reasons.add('unsupported_section')
        continue
      }
      report.sectionTypes[section.type]++
      if (Object.hasOwn(section, 'file_key')) report.sectionFileKeyOccurrences++
      if (Object.keys(section).some((key) => !attributes.has(key)))
        reasons.add('unsupported_attribute')
      if (
        ['name', 'uuid', 'file_key'].some(
          (key) => section[key] !== undefined && typeof section[key] !== 'string'
        )
      )
        reasons.add('invalid_section')
      if (section.type === 'posting_title' && posting.posting_title_present !== true)
        reasons.add('missing_dynamic_text')
      if (section.type === 'company_intro' && posting.company_intro_present !== true)
        reasons.add('missing_dynamic_text')
      if (section.type === 'custom') {
        if (
          !Array.isArray(section.items) ||
          section.items.some(
            (item) =>
              !record(item) || typeof item.label !== 'string' || typeof item.value !== 'string'
          )
        )
          reasons.add('invalid_custom')
        else if (
          section.items.some((item) =>
            Object.keys(item).some((key) => !['label', 'value'].includes(key))
          )
        )
          reasons.add('unsupported_attribute')
      }
      if (section.type === 'image') {
        report.imageReferences++
        requireFile(section.image_key, ['posting_detail_img', 'posting_detail', 'content_image'])
      }
      if (!['content', 'content_link'].includes(section.type)) continue
      const resourceId = id(section.resource_id)
      if (!resourceId) {
        reasons.add('invalid_resource_id')
        continue
      }
      const candidates = byResource.get(resourceId) ?? []
      if (candidates.length !== 1) {
        reasons.add(candidates.length ? 'ambiguous_resource' : 'missing_resource')
        continue
      }
      const resource = candidates[0]
      // 복사 metadata는 공개 출력·편집에 사용되지 않아 stale이어도 차단하지 않는다.
      if (section.file_key !== undefined && section.file_key !== resource.file_key)
        report.sectionFileKeyStale++
      if (resource.status !== 1) reasons.add('inactive_resource')
      if (resource.content_type !== 'excalidraw') reasons.add('unsupported_content_type')
      if (
        !['posting_detail', 'detail_template'].includes(resource.source_type) ||
        !id(resource.owner_brand_id)
      )
        reasons.add('unknown_resource_owner')
      else if (resource.owner_brand_id !== posting.brand_id) reasons.add('cross_space_resource')
      if (section.image_key !== undefined && section.image_key !== resource.image_key)
        reasons.add('image_source_mismatch')
      report.imageReferences++
      requireFile(resource.image_key, ['content_image'])
      if (keyPresent(resource.file_key)) {
        report.sceneReferences++
        requireFile(resource.file_key, ['content_data'])
      } else if (section.type === 'content') reasons.add('missing_scene_key')
      else if (resource.file_key !== '' && resource.file_key !== null)
        reasons.add('invalid_scene_key')
      if (
        section.type === 'content_link' &&
        section.url !== undefined &&
        section.url !== '' &&
        !validUrl(section.url)
      )
        reasons.add('invalid_link')
    }
    if (reasons.size) {
      report.blocked++
      for (const reason of reasons) report.reasons[reason] = (report.reasons[reason] ?? 0) + 1
    } else if (assets) report.assetVerificationPending++
    else report.plannedStructural++
  }
  return report
}

export async function inspectContentReadiness(client, ids) {
  // 함수 직접 호출에도 전체 고객 조회나 SQL scope 우회를 허용하지 않는다.
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    parseScope(['--spaces', ids.join(',')]).length !== ids.length
  )
    throw Error('scope')
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    await client.query("SET LOCAL statement_timeout = '30s'")
    await client.query("SET LOCAL lock_timeout = '3s'")
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'")
    await client.query('SET LOCAL search_path = public, pg_catalog')
    const scope = await client.query(
      'SELECT count(*)::text AS total FROM brand WHERE id = ANY($1::bigint[])',
      [ids]
    )
    if (Number(scope.rows[0].total) !== ids.length) throw Error('scope')
    const stamp = await client.query('SELECT transaction_timestamp() AS snapshot_at')
    const { rows } = await client.query(
      `SELECT id::text, brand_id::text, detail::jsonb, detail_image_key,
      posting_title IS NOT NULL AS posting_title_present, company_intro IS NOT NULL AS company_intro_present
      FROM posting WHERE brand_id = ANY($1::bigint[]) ORDER BY id`,
      [ids]
    )
    const resourceIds = new Set()
    const keys = new Set()
    for (const posting of rows) {
      if (keyPresent(posting.detail_image_key)) keys.add(posting.detail_image_key)
      for (const section of Array.isArray(posting.detail) ? posting.detail : []) {
        if (!record(section) || section.enabled !== true) continue
        if (['content', 'content_link'].includes(section.type) && id(section.resource_id))
          resourceIds.add(id(section.resource_id))
        if (section.type === 'image' && keyPresent(section.image_key)) keys.add(section.image_key)
      }
    }
    // content에는 brand_id가 없어 원본 source 관계로 소유 고객을 확인한다.
    const { rows: resources } = await client.query(
      `SELECT c.id::text, c.status, c.content_type, c.source_type, c.file_key, c.image_key,
      CASE WHEN c.source_type = 'posting_detail' THEN p.brand_id::text
        WHEN c.source_type = 'detail_template' THEN dt.brand_id::text END AS owner_brand_id
      FROM content c LEFT JOIN posting p ON c.source_type = 'posting_detail' AND p.id = c.source_id
      LEFT JOIN detail_template dt ON c.source_type = 'detail_template' AND dt.id = c.source_id
      WHERE c.id = ANY($1::bigint[])`,
      [[...resourceIds]]
    )
    for (const resource of resources) {
      if (keyPresent(resource.image_key)) keys.add(resource.image_key)
      if (keyPresent(resource.file_key)) keys.add(resource.file_key)
    }
    const { rows: files } = await client.query(
      `SELECT file_key, status, target_type, storage_type, storage FROM file WHERE file_key = ANY($1::text[])`,
      [[...keys]]
    )
    const content = summarizeOpeningContent(rows, resources, files)
    return {
      version: 1,
      snapshotAt: stamp.rows[0].snapshot_at,
      scopeCount: ids.length,
      status: content.blocked ? 'REVIEW_REQUIRED' : 'STRUCTURE_CHECKED_ONLY',
      content,
      unverified: [
        'scene_json_and_embedded_files',
        'image_bytes_and_checksums',
        'file_target_ownership_and_bucket_allowlist',
        'dynamic_relation_text_and_manager_decryption',
        'approved_apply_url_mapping',
        'asset_copy',
        'target_import',
      ],
    }
  } finally {
    await client.query('ROLLBACK')
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'OPENING_ENV_FILE=/secure/source.env OPENING_CA_FILE=/secure/ca.pem node scripts/audit-opening-content-readiness.mjs --spaces 1,2\n종료 코드: 0=구조 검사 완료(이전 가능 판정 아님), 2=구조 차단, 1=검사 실패'
    )
    return 0
  }
  let client
  try {
    const ids = parseScope(args)
    const env = parse(readFileSync(process.env.OPENING_ENV_FILE))
    const url = new URL(env.DATABASE_URL)
    for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(key)
    client = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: true, ca: readFileSync(process.env.OPENING_CA_FILE, 'utf8') },
      options: '-c default_transaction_read_only=on',
      application_name: 'opening-content-readiness',
    })
    await client.connect()
    const report = await inspectContentReadiness(client, ids)
    console.log(JSON.stringify(report, null, 2))
    return report.content.blocked ? 2 : 0
  } catch {
    console.error(
      '콘텐츠 검사 실패: 고객 범위·접속 설정·TLS 인증서·원본 스키마를 확인하세요. 상세 원문은 출력하지 않습니다.'
    )
    return 1
  } finally {
    if (client) await client.end().catch(() => {})
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2))
