import { act, fireEvent, render, screen } from '@testing-library/react'
import { ApplyForm } from '@/components/hiring-public/apply-form'
it('복수 파일을 보존하고 개별 제거 후 manifest와 함께 제출한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true })
  const { container } = render(
    <ApplyForm
      postingUuid="qa"
      fields={[
        { key: 'a', type: 'file', label: '자료', required: true, maxFileCount: 2, maxFileSize: 10 },
      ]}
      positions={[]}
      stores={[]}
    />
  )
  const input = screen.getByLabelText('자료', { exact: false })
  expect(input).toHaveAttribute('multiple')
  fireEvent.change(input, {
    target: { files: [new File(['1'], 'one.pdf'), new File(['2'], 'two.pdf')] },
  })
  expect(screen.getByText('one.pdf')).toBeInTheDocument()
  expect(screen.getByText('two.pdf')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '자료 one.pdf 첨부 제거' }))
  expect(screen.queryByText('one.pdf')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox'))
  await act(async () => fireEvent.submit(container.querySelector('form')!))
  const body = (fetch as jest.Mock).mock.calls[0][1].body as FormData
  expect(JSON.parse(body.get('payload') as string).fileFieldKeys).toEqual(['a'])
  expect((body.get('files') as File).name).toBe('two.pdf')
})
