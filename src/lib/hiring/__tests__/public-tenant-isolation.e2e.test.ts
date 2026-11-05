/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import * as XLSX from 'xlsx'
import { NextRequest } from 'next/server'
import { POST as copyPosting } from '../../../../app/api/hiring-posts/postings/[id]/copy/route'
import {
  POST as saveTemplate,
  GET as listTemplates,
} from '../../../../app/api/hiring-posts/templates/route'
import { GET as getTemplate } from '../../../../app/api/hiring-posts/templates/[id]/route'
import { POST as applyTemplate } from '../../../../app/api/hiring-posts/postings/[id]/apply-template/route'
import { POST as completeSubmission } from '../../../../app/api/hiring-public/upload-sessions/complete/route'
import { uploadTokenHash } from '@/lib/hiring/upload-protocol'
import { GET as getStores } from '../../../../app/api/hiring-posts/postings/[id]/stores/route'
import { GET as getPositions } from '../../../../app/api/hiring-posts/postings/[id]/positions/route'
import { GET as getContents } from '../../../../app/api/hiring-posts/postings/[id]/contents/route'
import { POST as addContent } from '../../../../app/api/hiring-posts/postings/[id]/contents/route'
import { prisma } from '@/lib/prisma'
import PublicPage from '../../../../app/p/[uuid]/page'
import { getPostingDetail } from '@/lib/hiring/postings'
import { getApplicationDetail, listApplications } from '@/lib/hiring/applications'
import { GET as exportApplications } from '../../../../app/api/hiring-applicants/applications/export/route'
import { GET as getFile } from '../../../../app/api/hiring-applicants/applications/[id]/files/[fileId]/route'
import { getApplicantFileSignedUrl } from '@/lib/hiring/storage'
import ApplyPage from '../../../../app/p/[uuid]/apply/page'

jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveDeckContext: async () => ({
    space: { id: process.env.QA_PUBLIC_SPACE },
    role: 'ADMIN',
    user: { id: 'qa-user' },
  }),
}))
jest.mock('@/lib/hiring/storage', () => ({
  ...jest.requireActual('@/lib/hiring/storage'),
  getApplicantFileSignedUrl: jest.fn(async () => 'https://storage.invalid/qa'),
}))
jest.mock('@/components/hiring-public/apply-form', () => ({
  ApplyForm: ({
    positions,
    stores,
  }: {
    positions: { name: string }[]
    stores: { name: string }[]
  }) =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement('div', null, [...positions, ...stores].map((x) => x.name).join('|')),
}))

it('고객 간 잘못 연결된 자료를 공개·관리·템플릿·지원자 경로에서 제외한다', async () => {
  const ref = 'tumkfkfgzkmisguyaghn'
  if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname !== `${ref}.supabase.co`)
    throw Error('DEV_PROJECT_REQUIRED')
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const value = process.env[key]
    if (!value) continue
    const url = new URL(value)
    if (
      url.hostname !== `db.${ref}.supabase.co` &&
      !(
        url.hostname.endsWith('.pooler.supabase.com') &&
        decodeURIComponent(url.username).endsWith(`.${ref}`)
      )
    )
      throw Error('DEV_DATABASE_REQUIRED')
  }
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) throw Error('DEV_DATABASE_REQUIRED')
  const spaces = [`qa-public-${randomUUID()}`, `qa-public-${randomUUID()}`]
  const globalId = `qa-public-template-${randomUUID()}`
  const created: string[] = []
  try {
    for (const id of spaces) {
      await prisma.space.create({ data: { id, name: '[QA] 공개 범위' } })
      created.push(id)
    }
    const own = await prisma.hiringStore.create({
      data: { spaceId: spaces[0], name: '내 합성 매장' },
    })
    const foreign = await prisma.hiringStore.create({
      data: { spaceId: spaces[1], name: '타 고객 합성 매장' },
    })
    const posting = await prisma.hiringPosting.create({
      data: {
        spaceId: spaces[0],
        title: '합성 공개 공고',
        status: 'ACTIVE',
        notificationEnabled: false,
        stores: { create: [{ storeId: own.id }, { storeId: foreign.id }] },
        positions: {
          create: [
            { spaceId: spaces[0], name: '내 합성 직무' },
            { spaceId: spaces[1], name: '타 고객 합성 직무' },
          ],
        },
        contents: {
          create: {
            spaceId: spaces[0],
            sourceType: 'POSTING_DETAIL',
            contentType: 'positions',
            sortOrder: 0,
          },
        },
      },
    })
    await prisma.hiringContent.create({
      data: {
        spaceId: spaces[1],
        postingId: posting.id,
        sourceType: 'POSTING_DETAIL',
        contentType: 'button',
        data: { title: '타 고객 합성 본문', linkType: 'url', url: 'https://example.invalid' },
      },
    })
    await prisma.hiringContent.create({
      data: {
        spaceId: null,
        postingId: posting.id,
        sourceType: 'POSTING_DETAIL',
        contentType: 'button',
        data: { title: '소유자 미확정 카드', linkType: 'url', url: 'https://example.invalid' },
      },
    })
    process.env.QA_PUBLIC_SPACE = spaces[0]
    const request = new NextRequest('http://localhost/qa')
    const params = { params: Promise.resolve({ id: posting.id }) }
    const storeRes = await getStores(request, params)
    const positionRes = await getPositions(request, params)
    const contentRes = await getContents(request, params)
    if (!storeRes || !positionRes || !contentRes) throw Error('관리 API 응답이 없습니다')
    expect((await storeRes.json()).storeIds).toEqual([own.id])
    expect((await positionRes.json()).positions.map((p: { name: string }) => p.name)).toEqual([
      '내 합성 직무',
    ])
    expect((await contentRes.json()).contents).toHaveLength(1)
    const copied = await copyPosting(
      new NextRequest('http://localhost/copy', { method: 'POST' }),
      params
    )
    if (!copied) throw Error('공고 복사 응답이 없습니다')
    expect(copied.status).toBe(201)
    const copyId = (await copied.json()).posting.id
    const rawCopy = await prisma.hiringPosting.findUniqueOrThrow({
      where: { id: copyId },
      include: { stores: true, positions: true, contents: true },
    })
    expect(rawCopy.stores.map((s) => s.storeId)).toEqual([own.id])
    expect(rawCopy.positions.map((p) => p.name)).toEqual(['내 합성 직무'])
    expect(rawCopy.contents).toHaveLength(1)
    const jsonRequest = (body: object) =>
      new NextRequest('http://localhost/qa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const orderingPosting = await prisma.hiringPosting.create({
      data: { spaceId: spaces[0], title: '정렬 검증' },
    })
    await prisma.hiringContent.create({
      data: {
        spaceId: spaces[1],
        postingId: orderingPosting.id,
        sourceType: 'POSTING_DETAIL',
        contentType: 'positions',
        sortOrder: 999,
      },
    })
    const added = await addContent(jsonRequest({ contentType: 'positions' }), {
      params: Promise.resolve({ id: orderingPosting.id }),
    })
    if (!added) throw Error('카드 추가 응답이 없습니다')
    expect(added.status).toBe(201)
    expect((await added.json()).content.sortOrder).toBe(0)
    const savedTemplate = await saveTemplate(
      jsonRequest({ postingId: posting.id, name: '합성 템플릿' })
    )
    if (!savedTemplate) throw Error('템플릿 저장 응답이 없습니다')
    expect(savedTemplate.status).toBe(201)
    const templateId = (await savedTemplate.json()).template.id
    const savedContents = await prisma.hiringContent.findMany({ where: { templateId } })
    expect(savedContents).toHaveLength(1)
    await prisma.hiringContent.create({
      data: {
        spaceId: spaces[1],
        templateId,
        sourceType: 'DETAIL_TEMPLATE',
        contentType: 'button',
        data: { title: '다른 고객 템플릿 카드', linkType: 'url', url: 'https://example.invalid' },
      },
    })
    const templateRes = await getTemplate(request, { params: Promise.resolve({ id: templateId }) })
    if (!templateRes) throw Error('템플릿 조회 응답이 없습니다')
    expect((await templateRes.json()).contents).toHaveLength(1)
    await prisma.hiringContent.create({
      data: {
        spaceId: spaces[1],
        postingId: copyId,
        sourceType: 'POSTING_DETAIL',
        contentType: 'button',
        data: {
          title: '다른 고객 복사 공고 카드',
          linkType: 'url',
          url: 'https://example.invalid',
        },
      },
    })
    const applied = await applyTemplate(jsonRequest({ templateId, mode: 'append' }), {
      params: Promise.resolve({ id: copyId }),
    })
    if (!applied) throw Error('템플릿 적용 응답이 없습니다')
    const appliedContents = (await applied.json()).contents
    expect(appliedContents).toHaveLength(2)
    expect(JSON.stringify(appliedContents)).not.toContain('다른 고객')
    const otherSample = await prisma.hiringDetailTemplate.create({
      data: { spaceId: spaces[1], name: '다른 고객 샘플', isSample: true },
    })
    await prisma.hiringContent.create({
      data: {
        spaceId: spaces[1],
        templateId: otherSample.id,
        sourceType: 'DETAIL_TEMPLATE',
        contentType: 'button',
      },
    })
    const otherTemplateRes = await getTemplate(request, {
      params: Promise.resolve({ id: otherSample.id }),
    })
    expect(otherTemplateRes?.status).toBe(404)
    const otherApplyRes = await applyTemplate(
      jsonRequest({ templateId: otherSample.id, mode: 'append' }),
      { params: Promise.resolve({ id: copyId }) }
    )
    expect(otherApplyRes?.status).toBe(404)
    const templatesRes = await listTemplates()
    if (!templatesRes) throw Error('템플릿 목록 응답이 없습니다')
    expect((await templatesRes.json()).templates.map((t: { id: string }) => t.id)).not.toContain(
      otherSample.id
    )
    const globalSample = await prisma.hiringDetailTemplate.create({
      data: { id: globalId, spaceId: null, name: '공용 샘플', isSample: true },
    })
    await prisma.hiringContent.createMany({
      data: [
        {
          spaceId: null,
          templateId: globalSample.id,
          sourceType: 'DETAIL_TEMPLATE',
          contentType: 'button',
          data: { title: '공용 카드' },
        },
        {
          spaceId: spaces[1],
          templateId: globalSample.id,
          sourceType: 'DETAIL_TEMPLATE',
          contentType: 'button',
          data: { title: '타 고객 카드' },
        },
      ],
    })
    const globalRes = await getTemplate(request, {
      params: Promise.resolve({ id: globalSample.id }),
    })
    if (!globalRes) throw Error('공용 템플릿 조회 응답이 없습니다')
    const globalContents = (await globalRes.json()).contents
    expect(globalContents).toHaveLength(1)
    expect(JSON.stringify(globalContents)).toContain('공용 카드')
    const globalApply = await applyTemplate(
      jsonRequest({ templateId: globalSample.id, mode: 'append' }),
      { params: Promise.resolve({ id: copyId }) }
    )
    if (!globalApply) throw Error('공용 템플릿 적용 응답이 없습니다')
    expect(globalApply.status).toBe(200)
    expect(JSON.stringify((await globalApply.json()).contents)).not.toContain('타 고객 카드')
    const globalList = await listTemplates()
    if (!globalList) throw Error('템플릿 목록 응답이 없습니다')
    expect((await globalList.json()).templates.map((t: { id: string }) => t.id)).toContain(
      globalSample.id
    )
    const overwritten = await saveTemplate(
      jsonRequest({ postingId: posting.id, name: '덮어쓰기', templateId })
    )
    expect(overwritten?.status).toBe(200)
    expect(await prisma.hiringContent.count({ where: { templateId, spaceId: spaces[1] } })).toBe(1)
    process.env.HIRING_HMAC_KEY = randomBytes(32).toString('hex')
    process.env.ENCRYPTION_KEY_PII = randomBytes(32).toString('hex')
    process.env.ENCRYPTION_WRITE_VERSION = 'v1'
    const positions = await prisma.hiringPostingPosition.findMany({
      where: { postingId: posting.id },
    })
    const ownPosition = positions.find((p) => p.spaceId === spaces[0])!
    const foreignPosition = positions.find((p) => p.spaceId === spaces[1])!
    const token = 'a'.repeat(64)
    const session = await prisma.hiringUploadSession.create({
      data: {
        spaceId: spaces[0],
        postingId: posting.id,
        tokenHash: uploadTokenHash(token),
        files: [],
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const payload = {
      postingUuid: posting.uuid,
      uploadSessionId: session.id,
      uploadToken: token,
      entries: [
        { key: 'name', type: 'string', value: '합성' },
        { key: 'phone', type: 'phone', value: '01000000000' },
      ],
      privacyAgreed: true,
    }
    const submit = (extra: object) =>
      completeSubmission(
        new NextRequest('http://localhost/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, ...extra }),
        })
      )
    expect((await submit({ postingPositionId: foreignPosition.id })).status).toBe(400)
    expect((await submit({ storeIds: [foreign.id] })).status).toBe(400)
    expect(await prisma.hiringApplication.count({ where: { spaceId: spaces[0] } })).toBe(0)
    expect((await submit({ postingPositionId: ownPosition.id, storeIds: [own.id] })).status).toBe(
      201
    )
    const saved = await prisma.hiringApplication.findUniqueOrThrow({
      where: { id: session.id },
      include: { stores: true },
    })
    expect(saved.postingPositionId).toBe(ownPosition.id)
    expect(saved.stores.map((s) => s.storeId)).toEqual([own.id])
    const createFile = (path: string) =>
      prisma.hiringApplicationFile.create({
        data: {
          spaceId: spaces[0],
          applicationId: saved.id,
          fileName: '합성.pdf',
          filePath: path,
          mimeType: 'application/pdf',
          sizeBytes: 1,
        },
      })
    const badFile = await createFile(`${spaces[1]}/applications/a/qa.pdf`)
    const traversedFile = await createFile(`${spaces[0]}/applications/../../${spaces[1]}/qa.pdf`)
    const normalFile = await createFile(`${spaces[0]}/applications/a/qa.pdf`)
    const migratedFile = await createFile(`${spaces[0]}/migration/a/qa.pdf`)
    const fetchFile = (fileId: string) =>
      getFile(request, { params: Promise.resolve({ id: saved.id, fileId }) })
    expect((await fetchFile(badFile.id))?.status).toBe(404)
    expect((await fetchFile(traversedFile.id))?.status).toBe(404)
    expect((await fetchFile(normalFile.id))?.status).toBe(200)
    expect((await fetchFile(migratedFile.id))?.status).toBe(200)
    expect(getApplicantFileSignedUrl).toHaveBeenCalledTimes(2)
    const foreignPosting = await prisma.hiringPosting.create({
      data: { spaceId: spaces[1], title: '다른 고객 공고' },
    })
    const mismatchedApp = await prisma.hiringApplication.create({
      data: {
        spaceId: spaces[0],
        postingId: foreignPosting.id,
        postingPositionId: foreignPosition.id,
        applicationEntries: [
          { key: 'qa-marker', type: 'string', label: 'QA 구분', value: '교차 연결' },
        ],
        stores: { create: { storeId: foreign.id } },
        files: {
          create: {
            spaceId: spaces[1],
            fileName: '다른 고객 파일.pdf',
            filePath: `${spaces[1]}/qa.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 1,
          },
        },
        comments: {
          create: { spaceId: spaces[1], userId: 'qa-user', content: '다른 고객 코멘트' },
        },
        notifications: {
          create: {
            spaceId: spaces[1],
            notiType: 'INTERVIEW',
            uuid: randomUUID(),
            detailMessage: '다른 고객 알림',
            tokenHash: 'qa',
            tokenExpireAt: new Date(Date.now() + 60_000),
          },
        },
      },
    })
    const applicationDetail = await getApplicationDetail(spaces[0], mismatchedApp.id)
    expect(applicationDetail?.app.posting).toBeNull()
    expect(applicationDetail?.app.postingPosition).toBeNull()
    expect(applicationDetail?.app.stores).toHaveLength(0)
    expect(applicationDetail?.app.files).toHaveLength(0)
    expect(applicationDetail?.app.comments).toHaveLength(0)
    expect(applicationDetail?.app.notifications).toHaveLength(0)
    const applications = await listApplications(spaces[0], { page: 1, pageSize: 50 })
    expect(applications.rows.find((r) => r.id === mismatchedApp.id)?.postingTitle).toBe(
      '(삭제된 공고)'
    )
    const exportRes = await exportApplications(new NextRequest('http://localhost/export'))
    if (!exportRes) throw Error('지원자 Excel 응답이 없습니다')
    const workbook = XLSX.read(Buffer.from(await exportRes.arrayBuffer()), { type: 'buffer' })
    const exportRows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['지원자'])
    expect(exportRows.find((row) => row['QA 구분'] === '교차 연결')?.공고 ?? '').toBe('')
    const props = {
      params: Promise.resolve({ uuid: posting.uuid }),
      searchParams: Promise.resolve({}),
    }
    const detail = await getPostingDetail(spaces[0], posting.id)
    expect(detail?.stores.map((s) => s.storeId)).toEqual([own.id])
    expect(detail?.positions.map((p) => p.name)).toEqual(['내 합성 직무'])
    expect(detail?.contents).toHaveLength(1)
    const publicHtml = renderToStaticMarkup(await PublicPage(props))
    const applyHtml = renderToStaticMarkup(await ApplyPage(props))
    expect(publicHtml).not.toContain('소유자 미확정 카드')
    expect(publicHtml).not.toContain('타 고객 합성 본문')
    for (const html of [publicHtml, applyHtml]) {
      expect(html).toContain('내 합성 매장')
      expect(html).toContain('내 합성 직무')
      expect(html).not.toContain('타 고객 합성 매장')
      expect(html).not.toContain('타 고객 합성 직무')
    }
  } finally {
    await prisma.hiringDetailTemplate.deleteMany({ where: { id: globalId, spaceId: null } })
    expect(await prisma.hiringDetailTemplate.count({ where: { id: globalId } })).toBe(0)
    await prisma.hiringPostingPosition.deleteMany({ where: { spaceId: { in: created } } })
    for (const id of created) await prisma.space.deleteMany({ where: { id } })
    expect(await prisma.space.count({ where: { id: { in: created } } })).toBe(0)
    delete process.env.QA_PUBLIC_SPACE
    await prisma.$disconnect()
  }
})
