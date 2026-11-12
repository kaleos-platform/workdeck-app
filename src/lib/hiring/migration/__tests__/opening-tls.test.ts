import { Client } from 'pg'
import type { PeerCertificate } from 'node:tls'
import { openingTlsConfig } from '../opening-tls'

const url = 'postgresql://user:password@db.example.test:5432/db'

it('CA와 서버 인증을 실제 pg Client에 적용한다', () => {
  const client = new Client(openingTlsConfig(url, 'synthetic-ca'))
  expect(client.ssl).toMatchObject({ rejectUnauthorized: true, ca: 'synthetic-ca' })
})

it.each([
  '?sslmode=disable', '?sslmode=no-verify', '?ssl=false', '?ssl=0',
  '?sslrootcert=/tmp/cert', '?sslcert=/tmp/cert', '?sslkey=/tmp/key',
  '?uselibpqcompat=true&sslmode=require', '?sslmode=verify-full&sslmode=disable',
  '?%73%73%6cmode=disable', '?SSLMODE=disable',
  '?host=other.example.test', '?%68ost=127.0.0.1',
])('TLS를 덮어쓸 수 있는 URL 옵션을 거부한다: %s', (query) => {
  expect(() => openingTlsConfig(url + query, 'synthetic-ca')).toThrow('UNSAFE_DATABASE_URL')
})

it('안전한 연결 옵션은 보존하고 시스템 CA 검증을 사용한다', () => {
  const config = openingTlsConfig(url + '?application_name=opening', undefined)
  expect(config.connectionString).toContain('application_name=opening')
  expect(new Client(config).ssl).toMatchObject({ rejectUnauthorized: true })
})

it('pg가 localhost를 전달하더라도 URL의 IP와 인증서를 대조한다', () => {
  const config = openingTlsConfig('postgresql://user:password@127.0.0.1/db')
  const cert = { subject: { CN: 'localhost' }, subjectaltname: 'DNS:localhost' } as PeerCertificate
  expect(config.ssl.checkServerIdentity('localhost', cert)).toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
})

it('IPv6 URL의 대괄호를 제거해 인증서 IP와 대조한다', () => {
  const config = openingTlsConfig('postgresql://user:password@[::1]/db')
  const cert = { subject: { CN: 'unused' }, subjectaltname: 'IP Address:0:0:0:0:0:0:0:1' } as PeerCertificate
  expect(config.ssl.checkServerIdentity('localhost', cert)).toBeUndefined()
})
