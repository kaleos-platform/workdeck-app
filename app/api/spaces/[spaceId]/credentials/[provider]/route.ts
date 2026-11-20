/**
 * PUT — Space 자격증명 등록·교체(ADMIN 이상 + MFA aal2). 평문은 요청 본문으로만 받고 응답에 돌려주지 않는다.
 * 비밀값이 서버 밖으로 나가지 않도록 암호화는 서버에서 한다.
 * 메타: 매핑된 광고 계정의 통화를 Graph API로 확인해 config.accountCurrencies에 저장한다(확인 실패 시 저장하지 않음).
 * 구글 마케팅: refresh token은 필요한 최소 scope로 발급한다(코드가 scope를 줄일 수 없다 — 발급 scope가 그대로 쓰인다).
 *   권장: analytics.readonly, analytics.edit, tagmanager.readonly, tagmanager.edit.containers,
 *   tagmanager.edit.containerversions. tagmanager.publish는 GTM 게시(OWNER 승인 흐름)를 쓸 때만 넣는다.
 *   계정도 이 Space 브랜드의 GA4 속성·GTM 컨테이너에만 권한이 있는 계정을 쓴다.
 * 네이버 검색광고: 조회 전용. 매핑된 각 CUSTOMER_ID 로 캠페인 목록을 1번씩 조회해 키를 확인한다(실패 시 저장하지 않음).
 * 카페24: 앱 정보(쇼핑몰 ID·client_id·secret)만 받는다. 토큰은 OAuth 콜백이 저장하고, 쓰기는 무조건 upsert 가 아니라 조건부 쓰기(409 가능).
 * GET — 등록 상태·설정값(허용 필드만) 조회. 비밀값·암호문·오류 원문은 돌려주지 않는다(MFA 불필요, ADMIN 이상).
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
import { MALL_ID_RE } from '@/lib/cafe24/client'
import { registerCafe24 } from '@/lib/cafe24/store'
import { ensureNbaesongChannel } from '@/lib/naver-commerce/nbaesong-channel'
import { decryptField } from '@/lib/crypto/field-crypto'
import {
  nbaesongStoreLocationId,
  type NaverCommerceConfig,
  type NaverCommerceSecret,
} from '@/lib/naver-commerce/client'

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
  // 카페24 — 앱 정보만 받는다(토큰은 OAuth 콜백이 저장). 쓰기는 registerCafe24 의 조건부 쓰기.
  cafe24: z.object({
    secret: z.object({
      clientId: z.string().min(10).max(100),
      clientSecret: z.string().min(10).max(200),
    }),
    config: z.object({ mallId: z.string().regex(MALL_ID_RE) }),
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
          // 이미 저장된 스토어는 비워 두면 기존 키를 유지한다(서버에서 병합).
          .refine((o) => Object.keys(o).length <= 5),
      }),
      config: z.object({
        locationId: z.string().min(1),
        stores: z.array(
          z.object({
            key: z.string().regex(STORE_KEY),
            label: z.string().min(1).max(30),
            startDate: z.iso.date(),
            representativeChannelId: z.string().nullable(),
            locationId: z.string().min(1).nullable().optional(),
          })
        ),
      }),
    })
    .refine((v) => {
      const keys = new Set(v.config.stores.map((s) => s.key))
      return (
        keys.size === v.config.stores.length &&
        keys.size >= 1 &&
        keys.size <= 5 &&
        Object.keys(v.secret.stores).every((k) => keys.has(k))
      )
    }),
} as const

const READ_PROVIDERS = ['meta-ads', 'google-marketing', 'naver-searchad'] as const
const READ_FIELDS: Record<(typeof READ_PROVIDERS)[number], string[]> = {
  'meta-ads': ['defaultBrand', 'adAccounts', 'accountCurrencies', 'graphVersion'],
  'google-marketing': ['defaultBrand', 'brands'],
  'naver-searchad': ['defaultBrand', 'managerCustomerId', 'customers'],
}
const GOOGLE_BRAND_FIELDS = ['ga4_property_id', 'gtm_account_id', 'gtm_container_id']

const pick = (src: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]))

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { spaceId, provider } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  if (!(READ_PROVIDERS as readonly string[]).includes(provider))
    return errorResponse('지원하지 않는 provider입니다', 404)
  const p = provider as (typeof READ_PROVIDERS)[number]

  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider } },
    select: { config: true, lastVerifiedAt: true, lastError: true, healthError: true },
  })
  const noStore = { headers: { 'Cache-Control': 'no-store' } }
  if (!row)
    return NextResponse.json(
      { registered: false, config: null, lastVerifiedAt: null, hasError: false, pendingActions: 0 },
      noStore
    )

  const raw = (row.config ?? {}) as Record<string, unknown>
  const config = pick(raw, READ_FIELDS[p])
  if (p === 'google-marketing' && config.brands && typeof config.brands === 'object') {
    config.brands = Object.fromEntries(
      Object.entries(config.brands as Record<string, Record<string, unknown>>).map(([k, v]) => [
        k,
        pick(v ?? {}, GOOGLE_BRAND_FIELDS),
      ])
    )
  }
  // 네이버는 쓰기 액션이 없다.
  const pendingActions =
    p === 'naver-searchad'
      ? 0
      : await prisma.agentPendingAction.count({
          where: {
            spaceId,
            actionType: { startsWith: `${provider}.` },
            status: { in: ['PENDING', 'APPROVED'] },
          },
        })
  return NextResponse.json(
    {
      registered: true,
      config,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      hasError: !!(row.lastError || row.healthError),
      pendingActions,
    },
    noStore
  )
}

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

  if (provider === 'cafe24') {
    const c = parsed.data as z.infer<(typeof SCHEMAS)['cafe24']>
    const result = await registerCafe24(spaceId, { ...c.secret, mallId: c.config.mallId })
    if (result === 'conflict') {
      return errorResponse('다른 변경과 겹쳤습니다. 잠시 후 다시 시도해 주세요', 409)
    }
    return NextResponse.json({ provider }, { headers: { 'Cache-Control': 'no-store' } })
  }

  let config: Record<string, unknown> = parsed.data.config
  let secret: object = parsed.data.secret
  if (provider === 'meta-ads') {
    const meta = parsed.data as z.infer<(typeof SCHEMAS)['meta-ads']>
    // graphVersion 은 폼이 편집하지 않으므로 생략되면 기존 값을 보존한다. 확인 호출도 같은 버전으로 한다.
    const prevCfg =
      meta.config.graphVersion === undefined
        ? ((
            await prisma.spaceCredential.findUnique({
              where: { spaceId_provider: { spaceId, provider } },
              select: { config: true },
            })
          )?.config as { graphVersion?: string } | null)
        : null
    const merged = {
      ...meta.config,
      ...(prevCfg?.graphVersion ? { graphVersion: prevCfg.graphVersion } : {}),
    }
    try {
      // 예산 금액을 원으로 다루려면 계정 통화를 Meta에서 직접 확인해야 한다. 같은 호출이 토큰도 검증한다.
      config = {
        ...merged,
        accountCurrencies: await fetchAdAccountCurrencies(meta.secret, merged),
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
    const locIds = [
      ...new Set([
        nc.config.locationId,
        ...nc.config.stores.flatMap((st) => (st.locationId ? [st.locationId] : [])),
      ]),
    ]
    const locFound = await prisma.invStorageLocation.count({
      where: { id: { in: locIds }, spaceId },
    })
    if (locFound !== locIds.length) return errorResponse('출고 위치를 찾을 수 없습니다', 400)
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
      select: { config: true, encryptedPayload: true, iv: true },
    })
    const prevConfig = prev?.config as NaverCommerceConfig | null | undefined
    const prevStores = prevConfig?.stores ?? []
    if (new Set(nc.config.stores.map((st) => st.label)).size !== nc.config.stores.length)
      return errorResponse('스토어 이름이 중복됩니다', 400)
    // 수집 이력 = 커서 또는 N배송 묶음. 매칭 저장이 커서를 null 로 되돌리므로 묶음도 본다.
    const collected = new Set<string>()
    for (const st of prevStores) {
      const has =
        st.backfilledThrough != null ||
        !!(await prisma.delBatch.findFirst({
          where: { spaceId, source: 'NAVER_API', label: { startsWith: `N배송 ${st.key} ` } },
          select: { id: true },
        }))
      if (has) collected.add(st.key)
    }
    const newKeys = new Set(nc.config.stores.map((st) => st.key))
    if ([...collected].some((k) => !newKeys.has(k)))
      return errorResponse('수집 이력이 있는 스토어는 삭제할 수 없습니다', 400)
    // 비워 둔 스토어 키는 기존 값으로 채운다.
    let prevSecrets: NaverCommerceSecret['stores'] = {}
    const missing = nc.config.stores.filter((st) => !nc.secret.stores[st.key])
    if (missing.length > 0 && prev) {
      try {
        prevSecrets = (
          JSON.parse(
            decryptField('space-credential', prev.encryptedPayload, prev.iv)
          ) as NaverCommerceSecret
        ).stores
      } catch {
        return errorResponse('기존 자격증명을 읽지 못했습니다. 키를 다시 입력해 주세요', 400)
      }
    }
    if (missing.some((st) => !prevSecrets?.[st.key]))
      return errorResponse('새 스토어는 애플리케이션 ID와 시크릿을 입력해 주세요', 400)
    secret = {
      stores: Object.fromEntries(
        nc.config.stores.map((st) => [st.key, nc.secret.stores[st.key] ?? prevSecrets[st.key]])
      ),
    }
    // 출고 위치가 바뀐 스토어는 커서를 처음으로 되돌린다 — 워커가 전 기간을 다시 동기화하며
    // 기존 OUTBOUND 를 새 위치로 옮긴다(upsertOutboundMovement 가 옛 위치 차감분을 복원).
    const prevLoc = new Map(
      prevStores.map((st) => [st.key, prevConfig ? nbaesongStoreLocationId(prevConfig, st) : null])
    )
    const cursors = new Map(prevStores.map((st) => [st.key, st.backfilledThrough]))
    ncStores = nc.config.stores.map((st) => {
      const moved =
        prevLoc.has(st.key) && prevLoc.get(st.key) !== nbaesongStoreLocationId(nc.config, st)
      return {
        key: st.key,
        label: st.label,
        startDate: st.startDate,
        representativeChannelId: st.representativeChannelId,
        ...(st.locationId ? { locationId: st.locationId } : {}),
        backfilledThrough: moved ? null : (cursors.get(st.key) ?? null),
      }
    })
    config = { locationId: nc.config.locationId, stores: ncStores }
  }

  const { id } = await saveSpaceCredential(spaceId, provider, secret, config)
  // 확인 호출을 거친 저장은 점검 오류를 해제한다. healthAlertedAt 은 남겨 다음 점검에서 복구 알림이 나가게 한다.
  if (provider === 'meta-ads' || provider === 'naver-searchad') {
    await prisma.spaceCredential.update({
      where: { spaceId_provider: { spaceId, provider } },
      data: { healthError: null, lastVerifiedAt: new Date() },
    })
  }
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
