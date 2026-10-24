/**
 * PUT — Space 자격증명 등록·교체(ADMIN 이상 + MFA aal2). 평문은 요청 본문으로만 받고 응답에 돌려주지 않는다.
 * 비밀값이 서버 밖으로 나가지 않도록 암호화는 서버에서 한다.
 * 메타: 매핑된 광고 계정의 통화를 Graph API로 확인해 config.accountCurrencies에 저장한다(확인 실패 시 저장하지 않음).
 * 구글 마케팅: refresh token은 필요한 최소 scope로 발급한다(코드가 scope를 줄일 수 없다 — 발급 scope가 그대로 쓰인다).
 *   권장: analytics.readonly, analytics.edit, tagmanager.readonly, tagmanager.edit.containers,
 *   tagmanager.edit.containerversions. tagmanager.publish는 GTM 게시(OWNER 승인 흐름)를 쓸 때만 넣는다.
 *   계정도 이 Space 브랜드의 GA4 속성·GTM 컨테이너에만 권한이 있는 계정을 쓴다.
 * 네이버 검색광고: 조회 전용. 매핑된 각 CUSTOMER_ID 로 캠페인 목록을 1번씩 조회해 키를 확인한다(실패 시 저장하지 않음).
 * 삭제(DELETE) 라우트는 두지 않는다. 만들 때도 같은 requireAal2 관문을 둔다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { maskSecrets } from '@/lib/agent/audit'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { saveSpaceCredential } from '@/lib/agent/integrations/space-credential'
import { fetchAdAccountCurrencies } from '@/lib/agent/integrations/meta-ads'
import { verifyNaverCred } from '@/lib/agent/integrations/naver-searchad'
import { prisma } from '@/lib/prisma'
import { ensureNbaesongChannel } from '@/lib/naver-commerce/nbaesong-channel'
import type { NaverCommerceConfig } from '@/lib/naver-commerce/client'

type Ctx = { params: Promise<{ spaceId: string; provider: string }> }

const STORE_KEY = /^[a-z0-9-]{2,20}$/

const SCHEMAS = {
  'meta-ads': z.object({
    secret: z.object({ accessToken: z.string().min(10), appSecret: z.string().min(10) }),
    config: z.object({
      graphVersion: z
        .string()
        .regex(/^v\d+\.\d+$/)
        .optional(),
      defaultBrand: z.string().optional(),
      // 통화는 입력으로 받지 않는다. accountCurrencies 같은 모르는 키는 zod가 버리고, 서버가 Graph로 확인해 채운다.
      adAccounts: z.record(z.string(), z.string().regex(/^(act_)?\d+$/)),
    }),
  }),
  'google-marketing': z.object({
    secret: z.object({
      clientId: z.string().min(10),
      clientSecret: z.string().min(10),
      refreshToken: z.string().min(10),
    }),
    config: z.object({
      defaultBrand: z.string().optional(),
      brands: z.record(
        z.string(),
        z.object({
          ga4_property_id: z.string().regex(/^\d+$/),
          gtm_account_id: z.string().regex(/^\d+$/),
          gtm_container_id: z.string().regex(/^\d+$/),
        })
      ),
    }),
  }),
  'naver-searchad': z.object({
    secret: z.object({ apiKey: z.string().min(10), secretKey: z.string().min(10) }),
    config: z
      .object({
        defaultBrand: z.string().optional(),
        managerCustomerId: z.string().regex(/^\d+$/),
        // 저장 시 계정마다 직렬로 확인하므로 개수를 제한한다.
        customers: z
          .record(z.string(), z.string().regex(/^\d+$/))
          .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 20),
      })
      .refine((c) => !c.defaultBrand || Object.hasOwn(c.customers, c.defaultBrand)),
  }),
  // 스마트스토어 N배송 판매 수집 — Naver 호출은 워커가 한다(IP 등록). 여기선 저장·검증만.
  'naver-commerce': z
    .object({
      secret: z.object({
        stores: z
          .record(
            z.string().regex(STORE_KEY),
            z.object({ clientId: z.string().min(10), clientSecret: z.string().min(20) })
          )
          .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 5),
      }),
      config: z.object({
        locationId: z.string().min(1),
        stores: z.array(
          z.object({
            key: z.string().regex(STORE_KEY),
            label: z.string().min(1).max(30),
            startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            representativeChannelId: z.string().nullable(),
          })
        ),
      }),
    })
    .refine((v) => {
      const keys = new Set(v.config.stores.map((s) => s.key))
      const secretKeys = Object.keys(v.secret.stores)
      return (
        keys.size === v.config.stores.length &&
        keys.size === secretKeys.length &&
        secretKeys.every((k) => keys.has(k))
      )
    }),
} as const

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { spaceId, provider } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  // 자격증명 저장은 MFA(aal2) 필수. 본문을 읽기 전에 막는다.
  const mfaError = await requireAal2()
  if (mfaError) return mfaError

  if (!Object.hasOwn(SCHEMAS, provider)) return errorResponse('지원하지 않는 provider입니다', 404)
  const schema = SCHEMAS[provider as keyof typeof SCHEMAS]
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)

  let config: Record<string, unknown> = parsed.data.config
  if (provider === 'meta-ads') {
    const meta = parsed.data as z.infer<(typeof SCHEMAS)['meta-ads']>
    try {
      // 예산 금액을 원으로 다루려면 계정 통화를 Meta에서 직접 확인해야 한다. 같은 호출이 토큰도 검증한다.
      config = {
        ...meta.config,
        accountCurrencies: await fetchAdAccountCurrencies(meta.secret, meta.config),
      }
    } catch (err) {
      const reason = err instanceof Error ? maskSecrets(err.message) : '알 수 없는 오류'
      return errorResponse(`메타 광고 계정 확인 실패: ${reason}`, 400)
    }
  }

  if (provider === 'naver-searchad') {
    const naver = parsed.data as z.infer<(typeof SCHEMAS)['naver-searchad']>
    try {
      await verifyNaverCred(naver.secret, naver.config)
    } catch (err) {
      const reason = err instanceof Error ? maskSecrets(err.message) : '알 수 없는 오류'
      return errorResponse(`네이버 검색광고 계정 확인 실패: ${reason}`, 400)
    }
  }

  let ncStores: NaverCommerceConfig['stores'] = []
  if (provider === 'naver-commerce') {
    const nc = parsed.data as z.infer<(typeof SCHEMAS)['naver-commerce']>
    const location = await prisma.invStorageLocation.findFirst({
      where: { id: nc.config.locationId, spaceId },
      select: { id: true },
    })
    if (!location) return errorResponse('출고 위치를 찾을 수 없습니다', 400)
    const repIds = [
      ...new Set(
        nc.config.stores.flatMap((st) =>
          st.representativeChannelId ? [st.representativeChannelId] : []
        )
      ),
    ]
    if (repIds.length > 0) {
      const found = await prisma.channel.count({ where: { id: { in: repIds }, spaceId } })
      if (found !== repIds.length) return errorResponse('대표 채널을 찾을 수 없습니다', 400)
    }
    // 재저장해도 백필 진행도는 유지한다.
    const prev = await prisma.spaceCredential.findUnique({
      where: { spaceId_provider: { spaceId, provider } },
      select: { config: true },
    })
    const cursors = new Map(
      ((prev?.config as NaverCommerceConfig | null)?.stores ?? []).map((st) => [
        st.key,
        st.backfilledThrough,
      ])
    )
    ncStores = nc.config.stores.map((st) => ({
      ...st,
      backfilledThrough: cursors.get(st.key) ?? null,
    }))
    config = { locationId: nc.config.locationId, stores: ncStores }
  }

  const { id } = await saveSpaceCredential(spaceId, provider, parsed.data.secret, config)
  for (const st of ncStores) {
    await ensureNbaesongChannel({
      spaceId,
      storeKey: st.key,
      label: st.label,
      representativeChannelId: st.representativeChannelId,
    })
  }
  return NextResponse.json(
    {
      id,
      provider,
      ...(config.accountCurrencies ? { accountCurrencies: config.accountCurrencies } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
