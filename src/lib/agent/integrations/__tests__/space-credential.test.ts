/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceCredential: { upsert: jest.fn(), findUnique: jest.fn() } },
}))
// 저장 형식(버전 접두사·키 id 등)은 field-crypto가 정한다. 여기서는 불투명한 값으로 mock하고,
// encryptField의 결과가 그대로 저장되는지만 본다.
jest.mock('@/lib/crypto/field-crypto', () => ({
  encryptField: jest.fn(() => ({ encrypted: 'OPAQUE_CIPHERTEXT', iv: 'OPAQUE_IV' })),
  decryptField: jest.fn(),
}))
import { prisma } from '@/lib/prisma'
import { encryptField } from '@/lib/crypto/field-crypto'
import { saveSpaceCredential } from '../space-credential'

it('평문이 아니라 encryptField 결과(encryptedPayload + iv)만 저장한다', async () => {
  ;(prisma.spaceCredential.upsert as jest.Mock).mockResolvedValue({ id: 'c1' })
  await saveSpaceCredential('sp1', 'meta-ads', { accessToken: 'EAAB' }, { adAccounts: {} })
  expect(encryptField).toHaveBeenCalledWith(
    'space-credential',
    JSON.stringify({ accessToken: 'EAAB' })
  )
  const data = (prisma.spaceCredential.upsert as jest.Mock).mock.calls[0][0]
  expect(data.create).toMatchObject({ encryptedPayload: 'OPAQUE_CIPHERTEXT', iv: 'OPAQUE_IV' })
  expect(JSON.stringify(data)).not.toContain('EAAB')
})
