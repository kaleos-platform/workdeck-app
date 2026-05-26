/**
 * 암호 보호된 xlsx 처리 (서버 사이드).
 *
 * 스마트스토어 등 일부 채널 export 파일은 CFB 컨테이너로 감싸진 암호화 xlsx로 배포된다.
 * SheetJS Community 빌드는 open-password 복호화를 지원하지 않으므로 별도 라이브러리로 선처리한다.
 *
 * - `isEncryptedXlsx`: CFB 매직(D0 CF 11 E0...) + EncryptionInfo stream 존재로 판정
 * - `decryptXlsxBuffer`: 비밀번호로 평문 xlsx ArrayBuffer 반환. 잘못된 비밀번호는 throw.
 *
 * 비밀번호는 호출 컨텍스트의 메모리에서만 사용한다. 로그 출력·재전송 금지.
 */
import officeCrypto from 'officecrypto-tool'

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function hasCfbMagic(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer.slice(0, 8))
  return b.length >= 8 && CFB_MAGIC.every((v, i) => b[i] === v)
}

export function isEncryptedXlsx(buffer: ArrayBuffer): boolean {
  if (!hasCfbMagic(buffer)) return false
  try {
    return officeCrypto.isEncrypted(Buffer.from(buffer))
  } catch {
    return false
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('비밀번호가 올바르지 않습니다')
    this.name = 'WrongPasswordError'
  }
}

export async function decryptXlsxBuffer(
  buffer: ArrayBuffer,
  password: string
): Promise<ArrayBuffer> {
  if (!password) throw new WrongPasswordError()
  let decrypted: Buffer
  try {
    decrypted = await officeCrypto.decrypt(Buffer.from(buffer), { password })
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/password/i.test(msg)) throw new WrongPasswordError()
    throw err
  }
  return decrypted.buffer.slice(
    decrypted.byteOffset,
    decrypted.byteOffset + decrypted.byteLength
  ) as ArrayBuffer
}
