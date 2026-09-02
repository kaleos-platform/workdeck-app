import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LocationMappingTable, resolveDraftExternalCode } from '../location-mapping-table'
import { syntheticExternalCode } from '@/lib/inv/reconciliation-external-code'

describe('매핑 추가 — externalCode 결정', () => {
  it('코드 모드는 입력값을 그대로 쓴다', () => {
    expect(
      resolveDraftExternalCode({
        codeMode: 'code',
        externalCode: '  10104 ',
        externalName: '무시됨',
        externalOptionName: '',
      })
    ).toBe('10104')
  })

  it('이름 모드는 파서와 동일한 합성 키를 만든다', () => {
    // 파서(reconciliation-parser.ts:172)가 코드 없는 행에 쓰는 키와 같아야
    // 다음 대조에서 이 매핑이 1순위로 적용된다.
    const draftCode = resolveDraftExternalCode({
      codeMode: 'name',
      externalCode: '',
      externalName: '선 클렌징 패드 개별포장',
      externalOptionName: '60매',
    })

    expect(draftCode).toBe(syntheticExternalCode('선 클렌징 패드 개별포장', '60매'))
  })

  it('이름 모드에서 상품명이 비면 빈 문자열 — 저장 버튼이 막힌다', () => {
    expect(
      resolveDraftExternalCode({
        codeMode: 'name',
        externalCode: '',
        externalName: '   ',
        externalOptionName: '60매',
      })
    ).toBe('')
  })
})

describe('매핑 추가 UI', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ mappings: [] }),
    }) as unknown as typeof fetch
  })

  it('매핑이 없어도 추가 버튼이 보이고, 코드 입력 전에는 다음 단계로 못 넘어간다', async () => {
    render(
      <TooltipProvider>
        <LocationMappingTable locationId="loc-1" />
      </TooltipProvider>
    )

    const addButton = await screen.findByRole('button', { name: /매핑 추가/ })
    fireEvent.click(addButton)

    const next = await screen.findByRole('button', { name: '상품 옵션 선택' })
    expect(next).toBeDisabled()

    fireEvent.change(screen.getByLabelText('외부 코드'), { target: { value: '10104' } })
    await waitFor(() => expect(next).toBeEnabled())
  })
})
