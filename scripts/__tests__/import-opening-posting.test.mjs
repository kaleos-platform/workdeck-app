import { createHash } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseOptions,
  validateDestination,
  verifyPreparedAssets,
} from '../import-opening-posting.mjs'
const ref = 'abcdefghijklmnopqrst'
const env = {
  MIGRATION_ENVIRONMENT: 'validation',
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  DIRECT_URL: `postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres?sslmode=no-verify`,
  ENCRYPTION_KEY: 'ab'.repeat(32),
}
test('기본은 쓰기 없는 명시적 고객 범위 계획이다', () => {
  assert.equal(
    parseOptions(['--source-space', '9007199254740993', '--target-space', 'space']).apply,
    false
  )
  assert.throws(() => parseOptions([]))
  assert.throws(() => parseOptions(['--source-space', '1', '--target-space', 'space', '--apply']))
})
test('검증 프로젝트와 DB 대응을 검사하고 개발 환경은 거부한다', () => {
  assert.equal(new URL(validateDestination(env, ref)).searchParams.has('sslmode'), false)
  assert.throws(() => validateDestination(env, ref, env.NEXT_PUBLIC_SUPABASE_URL), /DEVELOPMENT/)
  assert.throws(
    () => validateDestination({ ...env, MIGRATION_ENVIRONMENT: 'production' }, ref),
    /VALIDATION/
  )
  assert.throws(
    () =>
      validateDestination(
        { ...env, DIRECT_URL: 'postgresql://postgres:synthetic@db.other.supabase.co/postgres' },
        ref
      ),
    /DATABASE_PROJECT/
  )
  assert.throws(() => validateDestination({ ...env, ENCRYPTION_KEY: '' }, ref), /ENCRYPTION/)
})

test('실제 자산 내용과 checksum을 대조하고 누락·잘못된 manifest는 차단한다', async () => {
  const bytes = new Uint8Array([1, 2, 3])
  const image = {
    copiedImagePath: 'space/image.png',
    verified: true,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  const content = { images: { 'index:0': image }, resources: {} }
  const blocks = [{ imagePath: image.copiedImagePath }, { imagePath: image.copiedImagePath }]
  let reads = 0
  assert.equal(
    await verifyPreparedAssets(content, blocks, async () => {
      reads++
      return bytes
    }),
    1
  )
  assert.equal(reads, 1)
  await assert.rejects(
    verifyPreparedAssets(content, blocks, async () => new Uint8Array([1])),
    /CHECKSUM_MISMATCH/
  )
  await assert.rejects(
    verifyPreparedAssets(
      { images: { x: { ...image, sha256: undefined } } },
      blocks,
      async () => bytes
    ),
    /MANIFEST_REQUIRED/
  )
  await assert.rejects(
    verifyPreparedAssets(
      { images: { a: image, b: { ...image, sizeBytes: 4 } } },
      blocks,
      async () => bytes
    ),
    /MANIFEST_CONFLICT/
  )
})

test('운영 파일럿은 명시적 모드와 환경 표시가 모두 일치할 때만 허용한다', () => {
  const production = { ...env, MIGRATION_ENVIRONMENT: 'production-pilot' }
  assert.throws(() => validateDestination(production, ref))
  assert.throws(() => validateDestination(env, ref, undefined, 'production-pilot'))
  assert.equal(
    new URL(validateDestination(production, ref, undefined, 'production-pilot')).hostname,
    `db.${ref}.supabase.co`
  )
  assert.throws(
    () =>
      validateDestination(production, ref, production.NEXT_PUBLIC_SUPABASE_URL, 'production-pilot'),
    /DEVELOPMENT/
  )
  assert.equal(
    parseOptions([
      '--source-space',
      '1',
      '--target-space',
      'space',
      '--target-mode',
      'production-pilot',
    ]).targetMode,
    'production-pilot'
  )
  assert.throws(() =>
    parseOptions(['--source-space', '1', '--target-space', 'space', '--target-mode', 'production'])
  )
})
