/** @jest-environment node */
import { createHash } from 'node:crypto'
import { auditAssetManifest, readMigrationAsset } from '../asset-audit'

const bytes = Buffer.from('합성 파일')
const entry = {
  bucket: 'hiring-assets' as const,
  path: 'space-a/migration/image.png',
  sizeBytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}

test('동일 객체를 원장 안에서 중복 다운로드하지 않고 실제 bytes를 비교한다', async () => {
  const read = jest.fn(async () => bytes)
  expect(await auditAssetManifest([entry, entry], 'space-a', read)).toMatchObject({
    images: { checked: 1, verified: 1 },
    attachments: { checked: 0 },
  })
  expect(read).toHaveBeenCalledTimes(1)
})
test('누락 기준값·다른 고객 경로·상충 manifest는 다운로드 전에 구분한다', async () => {
  const read = jest.fn(async () => bytes)
  expect(
    await auditAssetManifest([{ ...entry, sha256: undefined }], 'space-a', read)
  ).toMatchObject({ images: { manifestMissing: 1, verified: 0 } })
  expect(
    await auditAssetManifest([{ ...entry, path: 'other/image.png' }], 'space-a', read)
  ).toMatchObject({ images: { manifestInvalid: 1 } })
  expect(
    await auditAssetManifest([entry, { ...entry, sha256: '0'.repeat(64) }], 'space-a', read)
  ).toMatchObject({ images: { manifestInvalid: 1 } })
  expect(read).not.toHaveBeenCalled()
})
test('크기·내용 불일치와 읽기 실패를 성공으로 처리하거나 원문을 반환하지 않는다', async () => {
  expect(await auditAssetManifest([entry], 'space-a', async () => Buffer.alloc(1))).toMatchObject({
    images: { sizeMismatch: 1 },
  })
  expect(
    await auditAssetManifest([entry], 'space-a', async () => Buffer.alloc(bytes.length))
  ).toMatchObject({ images: { checksumMismatch: 1 } })
  const result = await auditAssetManifest(
    [{ ...entry, bucket: 'hiring-files' }],
    'space-a',
    async () => {
      throw Error('비밀 원문')
    }
  )
  expect(result).toMatchObject({ attachments: { readFailed: 1, verified: 0 } })
  expect(JSON.stringify(result)).not.toContain('비밀 원문')
  expect(JSON.stringify(result)).not.toContain(entry.path)
})
test('Storage GET은 고정 origin·redirect 금지·no-store로 읽고 과대 응답을 거부한다', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-key'
  const mock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(bytes))
  try {
    expect(await readMigrationAsset('hiring-assets', entry.path)).toEqual(bytes)
    expect(mock).toHaveBeenCalledWith(
      'https://example.supabase.co/storage/v1/object/authenticated/hiring-assets/space-a/migration/image.png',
      expect.objectContaining({ method: 'GET', redirect: 'error', cache: 'no-store' })
    )
    mock.mockResolvedValueOnce(new Response(new Uint8Array(20 * 1024 * 1024 + 1)))
    await expect(readMigrationAsset('hiring-assets', entry.path)).rejects.toThrow(
      'ASSET_READ_FAILED'
    )
    await expect(readMigrationAsset('hiring-assets', '../other')).rejects.toThrow(
      'ASSET_READ_FAILED'
    )
  } finally {
    mock.mockRestore()
  }
})
