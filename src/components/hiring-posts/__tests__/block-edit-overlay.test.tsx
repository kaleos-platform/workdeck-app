import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEditOverlay } from '../block-edit-overlay'
import type { WizardContentData } from '../build-types'

jest.mock('@/components/sc/editor/editor', () => ({
  Editor: () => <textarea aria-label="본문 입력" />,
}))
jest.mock('../step-positions', () => ({ StepPositions: () => null }))
jest.mock('../block-editors', () => ({
  CONTENT_TYPE_META: {
    design: { label: '디자인' },
    text: { label: '텍스트' },
  },
  DesignBlock: () => (
    <div className="excalidraw">
      <textarea
        aria-label="캔버스 텍스트"
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.dataset.finished = 'true'
        }}
      />
      <button>캔버스 도구</button>
    </div>
  ),
  ImageBlock: () => null,
  ButtonBlock: () => null,
}))

function mount(contentType: WizardContentData['contentType']) {
  const onClose = jest.fn()
  const content: WizardContentData = {
    id: 'qa-card',
    contentType,
    title: null,
    data: null,
    imagePath: null,
    sortOrder: 0,
  }
  render(
    <BlockEditOverlay
      open
      content={content}
      postingId="qa-posting"
      positions={[]}
      spacePositions={[]}
      onPositionsChange={jest.fn()}
      onClose={onClose}
      onTextChange={jest.fn()}
      onButtonSave={jest.fn()}
      onImageSelect={jest.fn()}
      onImageLinkSave={jest.fn()}
      onDesignSave={jest.fn()}
      onDesignLinkSave={jest.fn()}
    />
  )
  return onClose
}

it('캔버스 텍스트의 Escape는 편집기에 전달하고 바깥 팝업을 닫지 않는다', () => {
  const onClose = mount('design')
  const input = screen.getByRole('textbox', { name: '캔버스 텍스트' })
  fireEvent.change(input, { target: { value: '변경된 담당자' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  expect(input).toHaveAttribute('data-finished', 'true')
  expect(input).toHaveValue('변경된 담당자')
})

it('캔버스 도구의 Escape도 바깥 팝업을 닫지 않는다', () => {
  const onClose = mount('design')
  fireEvent.keyDown(screen.getByRole('button', { name: '캔버스 도구' }), { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
})

it('디자인 팝업의 닫기 버튼은 기존 닫기 검증을 호출한다', () => {
  const onClose = mount('design')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('일반 텍스트 팝업은 Escape로 닫을 수 있다', () => {
  const onClose = mount('text')
  fireEvent.keyDown(screen.getByRole('textbox', { name: '본문 입력' }), { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})
