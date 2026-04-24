import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { TemplateForm } from '@/components/sc/templates/template-form'

export default async function NewTemplatePage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">새 템플릿</h1>
      </div>
      <TemplateForm
        mode="create"
        initial={{
          kind: 'BLOG',
          sections: { sections: [{ key: 'title', kind: 'text', label: '제목' }] },
        }}
      />
    </div>
  )
}
