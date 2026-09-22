import { finTxnLabel } from '../txn-label'

describe('finTxnLabel', () => {
  it('description 에 없는 counterparty 는 병기한다', () => {
    expect(finTxnLabel({ description: 'BZ뱅크', counterparty: '(주)충남섬유' })).toBe(
      'BZ뱅크 / (주)충남섬유'
    )
  })

  it('description 에 이미 포함된 counterparty 는 중복 병기하지 않는다', () => {
    expect(finTxnLabel({ description: 'BZ뱅크 (주)충남섬유', counterparty: '(주)충남섬유' })).toBe(
      'BZ뱅크 (주)충남섬유'
    )
  })

  it('counterparty 가 없으면 description 그대로', () => {
    expect(finTxnLabel({ description: 'FB-RTF / 충남섬유', counterparty: null })).toBe(
      'FB-RTF / 충남섬유'
    )
  })

  it('description 이 없으면 counterparty 를 적요로 쓴다', () => {
    expect(finTxnLabel({ description: null, counterparty: '(주)충남섬유' })).toBe('(주)충남섬유')
  })

  it('둘 다 없으면 -', () => {
    expect(finTxnLabel({ description: null, counterparty: null })).toBe('-')
    expect(finTxnLabel({ description: '  ', counterparty: '' })).toBe('-')
  })
})
