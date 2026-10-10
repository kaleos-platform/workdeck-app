/**
 * 재암호화 헬퍼(v0 → v1, 비활성 kid → 활성 kid). 지연 재암호화(단일 비밀값 읽기)와 일괄 백필 스크립트가 같이 쓴다.
 * 쓰기 버전이 v0 인 동안에는 아무것도 바꾸지 않는다(needsReencrypt).
 */
import {
  decryptField,
  encryptField,
  needsReencrypt,
  type CryptoPurpose,
  type StoredField,
} from './field-crypto'

export type FieldPair = readonly [encField: string, ivField: string]

// 행의 (암호문, iv) 쌍 중 지금 쓰기 형식이 아닌 것(v0, 비활성 kid)만 바꾼 update data 를 만든다. 바꿀 게 없으면 null.
// iv='none'(평문) 은 건드리지 않는다 — 백필 리포트에서 "재등록 필요"로 따로 센다.
export function reencryptLegacyFields(
  purpose: CryptoPurpose,
  row: Record<string, unknown>,
  pairs: readonly FieldPair[]
): Record<string, string> | null {
  const data: Record<string, string> = {}
  for (const [encField, ivField] of pairs) {
    const enc = row[encField]
    const iv = row[ivField]
    if (typeof enc !== 'string' || typeof iv !== 'string' || iv === 'none') continue
    if (!needsReencrypt(purpose, enc)) continue
    const next = encryptField(purpose, decryptField(purpose, enc, iv))
    data[encField] = next.encrypted
    data[ivField] = next.iv
  }
  return Object.keys(data).length > 0 ? data : null
}

// 단일 비밀값 읽기 경로에서 v0(또는 비활성 kid)를 발견하면 지금 형식으로 저장한다.
// save 는 반드시 "기존 암호문과 같을 때만" 갱신하는 조건부 update 여야 한다(동시 수정 덮어쓰기 방지).
// 실패해도 읽기는 계속된다 — 다음 읽기나 백필이 다시 시도한다.
export async function upgradeIfLegacy(
  purpose: CryptoPurpose,
  stored: StoredField,
  plaintext: string,
  save: (next: StoredField) => Promise<unknown>
): Promise<void> {
  if (!needsReencrypt(purpose, stored.encrypted)) return
  try {
    await save(encryptField(purpose, plaintext))
  } catch (err) {
    // 오류 메시지에는 DB 값·비밀값이 섞일 수 있다 — 종류만 남긴다.
    console.warn(
      `[field-crypto] ${purpose} v1 재암호화 실패 — 다음 읽기에서 재시도`,
      err instanceof Error ? err.name : typeof err
    )
  }
}
