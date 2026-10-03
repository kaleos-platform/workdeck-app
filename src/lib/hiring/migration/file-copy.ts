import { createHash } from 'node:crypto'

type MigrationFileInput = {
  spaceId: string
  sourceRef: string
  expectedBytes: number
  expectedSha256: string
  mimeType: string
}

/**
 * readTarget은 파일이 없는 경우에만 null을 반환하고 나머지 오류는 전파한다.
 * writeTarget은 upsert: false로 기존 파일 덮어쓰기를 금지해야 한다.
 * 동시 생성 충돌이나 응답 실패는 호출자가 재시도하면 기존 파일 검증으로 복구된다.
 */
export async function copyMigrationFile(
  input: MigrationFileInput,
  storage: {
    readSource: () => Promise<Uint8Array>
    readTarget: (path: string) => Promise<Uint8Array | null>
    writeTarget: (path: string, bytes: Uint8Array, mimeType: string) => Promise<void>
  }
): Promise<{ path: string; bytes: number; sha256: string; status: 'created' | 'existing' }> {
  if (
    typeof input.spaceId !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(input.spaceId) ||
    typeof input.sourceRef !== 'string' ||
    !input.sourceRef.trim() ||
    !/^[a-f0-9]{64}$/.test(input.expectedSha256) ||
    !Number.isInteger(input.expectedBytes) ||
    input.expectedBytes < 1 ||
    input.expectedBytes > 20 * 1024 * 1024 ||
    !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(input.mimeType)
  ) {
    throw new Error('Invalid migration file input')
  }
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const matches = (bytes: Uint8Array) =>
    bytes.byteLength === input.expectedBytes && hash(bytes) === input.expectedSha256
  const source = await storage.readSource()
  if (!matches(source)) throw new Error('Migration file source checksum mismatch')
  const sourceKey = createHash('sha256').update(input.sourceRef).digest('hex')
  const path = `${input.spaceId}/migration/${sourceKey}/${input.expectedSha256}`
  const result = { path, bytes: input.expectedBytes, sha256: input.expectedSha256 }
  const existing = await storage.readTarget(path)
  if (existing !== null) {
    if (!matches(existing)) throw new Error('Migration file target conflict')
    return { ...result, status: 'existing' }
  }
  await storage.writeTarget(path, source, input.mimeType)
  const saved = await storage.readTarget(path)
  if (saved === null || !matches(saved)) throw new Error('Migration file verification failure')
  return { ...result, status: 'created' }
}
