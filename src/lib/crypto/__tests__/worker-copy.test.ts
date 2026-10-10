/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 워커는 별도 ESM 패키지라 이 모듈을 import 하지 못하고 복사본을 쓴다. 두 파일은 항상 같아야 한다.
test('worker/src/field-crypto.ts 는 src/lib/crypto/field-crypto.ts 와 바이트 단위로 같다', () => {
  const app = readFileSync(join(process.cwd(), 'src/lib/crypto/field-crypto.ts'))
  const worker = readFileSync(join(process.cwd(), 'worker/src/field-crypto.ts'))
  expect(worker.equals(app)).toBe(true)
})
