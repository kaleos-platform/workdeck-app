/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REENCRYPT_TARGETS } from '../reencrypt-targets'

const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

function modelBody(model: string): string {
  const m = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`schema 에 model ${model} 없음`)
  return m[1]
}

test.each(REENCRYPT_TARGETS.map((t) => [t.model, t] as const))(
  '%s 의 대상 컬럼이 schema 에 모두 있다',
  (_model, target) => {
    const body = modelBody(target.model)
    for (const [enc, iv] of target.pairs) {
      expect(body).toMatch(new RegExp(`\\n\\s+${enc}\\s`))
      expect(body).toMatch(new RegExp(`\\n\\s+${iv}\\s`))
    }
  }
)

// 용도가 바뀌면 데이터를 영영 못 읽는다 — 호출부(lib/sc/credentials, collection/secret-crypto, slack/token-crypto, billing, ai/resolve, del/encryption)와 맞춰 고정.
test('모델별 purpose 고정', () => {
  expect(Object.fromEntries(REENCRYPT_TARGETS.map((t) => [t.model, t.purpose]))).toEqual({
    CoupangCredential: 'collection-credential',
    CoupangApiCredential: 'collection-credential',
    ChannelCredential: 'channel-credential',
    SlackInstallation: 'slack-token',
    BillingMethod: 'billing-key',
    SpaceAiSetting: 'ai-key',
    DelOrder: 'pii',
    HiringPosting: 'pii',
    HiringApplication: 'pii',
    HiringMigrationRecord: 'pii',
    HiringBlacklist: 'pii',
  })
})

test('schema 의 모든 *Iv 컬럼이 대상에 포함된다(누락 방지)', () => {
  const covered = new Set(
    REENCRYPT_TARGETS.flatMap((t) => t.pairs.map(([, iv]) => `${t.model}.${iv}`))
  )
  const found: string[] = []
  for (const m of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
    for (const f of m[2].matchAll(/\n\s+(\w*(?:Iv|iv))\s+String/g)) found.push(`${m[1]}.${f[1]}`)
  }
  expect(found.filter((x) => !covered.has(x))).toEqual([])
})
