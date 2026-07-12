import { redirect, notFound } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getPostingDetail, DEFAULT_FORM_FIELDS } from '@/lib/hiring/postings'
import { BuildWizard } from '@/components/hiring-posts/build-wizard'
import type { WizardData } from '@/components/hiring-posts/build-types'
import type { FormFieldInput } from '@/lib/validations/hiring-posts'

type PageProps = { params: Promise<{ id: string }> }

// 공고 빌드 위저드 페이지
export default async function BuildPage({ params }: PageProps) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const { id } = await params

  const posting = await getPostingDetail(resolved.space.id, id)
  if (!posting) notFound()

  const [spaceStores, spacePositions] = await Promise.all([
    prisma.hiringStore.findMany({
      where: { spaceId: resolved.space.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, roadAddress: true },
    }),
    prisma.hiringPosition.findMany({
      where: { spaceId: resolved.space.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, category: true },
    }),
  ])

  const formFields = Array.isArray(posting.applicationEntries)
    ? (posting.applicationEntries as unknown as FormFieldInput[])
    : DEFAULT_FORM_FIELDS

  const data: WizardData = {
    posting: {
      id: posting.id,
      uuid: posting.uuid,
      title: posting.title,
      status: posting.status,
      closingDate: posting.closingDate ? posting.closingDate.toISOString() : null,
      notificationEnabled: posting.notificationEnabled,
      positions: posting.positions.map((p) => ({
        id: p.id,
        positionId: p.positionId,
        name: p.name,
        jobType: p.jobType,
        payFrequency: p.payFrequency,
        payAmount: p.payAmount,
        workDays: Array.isArray(p.workDays) ? (p.workDays as number[]) : null,
        workStartAt: p.workStartAt,
        workEndAt: p.workEndAt,
        headcount: p.headcount,
        experience: p.experience,
        education: p.education,
        jobDescription: p.jobDescription,
        requiredQualifications: p.requiredQualifications,
        preferredQualifications: p.preferredQualifications,
      })),
      storeIds: posting.stores.map((s) => s.storeId),
      contents: posting.contents.map((c) => ({
        id: c.id,
        contentType: c.contentType as WizardData['posting']['contents'][number]['contentType'],
        data: c.data,
        imagePath: c.imagePath,
        sortOrder: c.sortOrder,
      })),
      formFields,
      appliedTemplateName: posting.appliedTemplateName,
    },
    spaceStores,
    spacePositions,
  }

  return <BuildWizard data={data} />
}
