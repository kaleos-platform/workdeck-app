export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
    // v0 쓰기인데 K0 가 없으면 서버 부팅이 실패한다 — K0 폐기 뒤 복구는 롤포워드만(키 보존 규칙).
    const { assertFieldCryptoBootConfig } = await import('./lib/crypto/field-crypto')
    assertFieldCryptoBootConfig()
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}
