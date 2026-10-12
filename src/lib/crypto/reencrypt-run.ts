/**
 * 일괄 재암호화 실행기(scripts/security/reencrypt-v0.ts 가 사용). DB 접근은 db 인자로 주입해 단위 테스트한다.
 * 안전장치:
 *  1) 쓰기 전에 앱이 쓴 v1 행을 지금 설정된 K1 으로 복호화해 본다 — 틀린 K1 로 재암호화하면 원본 CBC 가 덮어써져 복구 불가.
 *  2) --apply 에서 복호화 실패가 한 건이라도 나오면 즉시 중단한다(틀린 K0 는 1/256 확률로 쓰레기 평문을 만든다).
 */
import { decryptField, purposeEnvName, type CryptoPurpose } from './field-crypto'
import { reencryptLegacyFields } from './reencrypt'
import type { REENCRYPT_TARGETS } from './reencrypt-targets'

export type Delegate = {
  findMany(args: unknown): Promise<Array<Record<string, unknown> & { id: string }>>
  updateMany(args: unknown): Promise<{ count: number }>
}

const BATCH = 200

export class AbortRun extends Error {}

// 용도별 직접 키 env(ENCRYPTION_KEY_<PURPOSE>, _K2 …). 이름은 field-crypto 의 purposeEnvName 에서 얻는다.
function directKeyEnvNames(purpose: CryptoPurpose): string[] {
  const base = purposeEnvName(purpose)
  const re = new RegExp(`^${base}(_K[1-9][0-9]*)?$`)
  return Object.keys(process.env).filter((k) => re.test(k) && process.env[k])
}

async function verifyK1(
  db: Record<string, Delegate>,
  targets: typeof REENCRYPT_TARGETS,
  k1Unverified: boolean,
  log: (m: string) => void
) {
  const verified = new Set<CryptoPurpose>()
  const sources: string[] = []
  for (const t of targets) {
    if (verified.has(t.purpose)) continue
    const delegate = db[t.model[0].toLowerCase() + t.model.slice(1)]
    for (const [enc, iv] of t.pairs) {
      const [row] = await delegate.findMany({
        where: { [iv]: 'v1' },
        select: { [enc]: true },
        take: 1,
      })
      if (!row) continue
      try {
        decryptField(t.purpose, row[enc] as string, 'v1')
      } catch {
        throw new AbortRun(
          `K1 검증 실패: ${t.model}.${enc} 의 v1 행(${t.purpose})을 지금 설정된 ENCRYPTION_KEY_V1 로 복호화할 수 없습니다. 키가 운영 앱이 쓰는 값인지 확인하세요. 아무것도 바꾸지 않았습니다`
        )
      }
      verified.add(t.purpose)
      sources.push(`${t.purpose}=${directKeyEnvNames(t.purpose)[0] ?? 'ENCRYPTION_KEY_V1'}`)
      break
    }
  }
  if (verified.size === 0) {
    if (!k1Unverified) {
      throw new AbortRun(
        'K1 검증 불가: 복호화해 볼 앱 작성 v1 행이 어떤 모델에도 없습니다. 틀린 K1 로 재암호화하면 복구할 수 없으므로 중단합니다. 빈 DB 등 의도한 경우에만 --k1-unverified 를 붙이세요'
      )
    }
    log('경고: --k1-unverified — K1 을 기존 v1 데이터로 검증하지 않았습니다')
  } else {
    log(`K1 검증 통과(용도=사용한 키 env 이름: ${sources.join(', ')})`)
  }
}

export async function runReencrypt(opts: {
  db: Record<string, Delegate>
  targets: typeof REENCRYPT_TARGETS
  apply: boolean
  k1Unverified?: boolean
  log?: (m: string) => void
  error?: (m: string) => void
}): Promise<{ failed: number }> {
  const { db, targets, apply } = opts
  const log = opts.log ?? console.log
  const error = opts.error ?? console.error
  if (apply) {
    // 루트 ENCRYPTION_KEY_V1 만으로 모든 용도 키를 파생해야 K1 검증이 전체를 보증한다.
    const direct = [...new Set(targets.map((t) => t.purpose))].flatMap(directKeyEnvNames)
    if (direct.length > 0) {
      throw new AbortRun(
        `--apply 는 용도별 키 env 가 설정돼 있으면 실행하지 않습니다(${direct.join(', ')}). 해제하고 루트 ENCRYPTION_KEY_V1 만 두세요. 아무것도 바꾸지 않았습니다`
      )
    }
  }
  await verifyK1(db, targets, !!opts.k1Unverified, log)
  if (apply) {
    // 쓰기 전에 전체를 읽기 전용으로 한 번 복호화해 본다 — 틀린 K0 가 쓰레기 행을 쓰는 틈을 없앤다.
    const pre = await pass(false, () => {})
    if (pre.failed > 0) {
      throw new AbortRun(
        `사전 복호화 점검에서 ${pre.failed}행 실패 — 키(ENCRYPTION_KEY=K0, K1)를 확인하세요. 아무것도 바꾸지 않았습니다`
      )
    }
  }
  return pass(apply, log)

  async function pass(apply: boolean, log: (m: string) => void): Promise<{ failed: number }> {
    let totalFailed = 0
    for (const target of targets) {
      const delegate = db[target.model[0].toLowerCase() + target.model.slice(1)]
      const select: Record<string, true> = { id: true }
      for (const [enc, iv] of target.pairs) {
        select[enc] = true
        select[iv] = true
      }

      let cursor: string | undefined
      let legacy = 0
      let updated = 0
      let raced = 0
      let plaintext = 0
      let failed = 0
      for (;;) {
        const rows = await delegate.findMany({
          select,
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        })
        if (rows.length === 0) break
        cursor = rows[rows.length - 1].id

        for (const row of rows) {
          plaintext += target.pairs.filter(([, iv]) => row[iv] === 'none').length
          let data: Record<string, string> | null
          try {
            data = reencryptLegacyFields(target.purpose, row, target.pairs)
          } catch (err) {
            failed += 1
            totalFailed += 1
            error(`[${target.model}] ${row.id} 복호화 실패: ${(err as Error).message}`)
            if (apply) {
              throw new AbortRun(
                `--apply 중 복호화 실패로 중단합니다(이후 쓰기 없음). 키(ENCRYPTION_KEY=K0, K1)를 확인하세요`
              )
            }
            continue
          }
          if (!data) continue
          legacy += 1
          if (!apply) continue
          const where: Record<string, unknown> = { id: row.id }
          for (const [enc] of target.pairs) if (enc in data) where[enc] = row[enc]
          const res = await delegate.updateMany({ where, data })
          updated += res.count
          if (res.count === 0) raced += 1
        }
      }
      log(
        `${target.model}: 대상(v0·비활성 kid) ${legacy}행, 갱신 ${updated}행, 경합 건너뜀 ${raced}행, 평문(iv=none) ${plaintext}칸, 실패 ${failed}행${apply ? '' : ' (dry-run)'}`
      )
    }
    return { failed: totalFailed }
  }
}
