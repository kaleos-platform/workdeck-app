import { prisma } from '@/lib/prisma'

/**
 * 채널 자체 배송(연동) 채널 ↔ 대표 채널(통합재고) self-relation 무결성 검증.
 *
 * 규칙:
 * - 대표 채널은 같은 space 소속이어야 한다.
 * - 대표 채널은 externalSource=null(통합재고/판매자배송)이어야 한다. 연동 채널은 대표가 될 수 없다.
 * - 자기 자신을 대표로 지정할 수 없다.
 * - representativeChannelId를 설정하는 주체 채널은 externalSource!=null(연동 채널)이어야 한다.
 *   통합재고 채널엔 대표 개념이 없다.
 *
 * @returns 검증 통과 시 null, 실패 시 한국어 에러 메시지.
 */
export async function validateRepresentativeChannel(params: {
  spaceId: string
  /** 관계를 설정하는 채널 id. 신규 생성 시 아직 없으면 undefined. */
  selfChannelId?: string
  /** 설정 주체 채널의 externalSource (신규/기존). null이면 통합재고 채널 → 대표 지정 불가. */
  selfExternalSource: string | null | undefined
  /** 지정하려는 대표 채널 id. null이면 해제(검증 통과). */
  representativeChannelId: string | null
}): Promise<string | null> {
  const { spaceId, selfChannelId, selfExternalSource, representativeChannelId } = params

  // 해제는 항상 허용
  if (representativeChannelId == null) return null

  // 연동 채널(externalSource!=null)만 대표를 가질 수 있다
  if (selfExternalSource == null) {
    return '통합재고 채널에는 대표 채널을 지정할 수 없습니다. 채널 자체 배송(연동) 채널에서만 설정하세요'
  }

  // 자기참조 금지
  if (selfChannelId && representativeChannelId === selfChannelId) {
    return '자기 자신을 대표 채널로 지정할 수 없습니다'
  }

  const rep = await prisma.channel.findFirst({
    where: { id: representativeChannelId, spaceId },
    select: { id: true, externalSource: true },
  })
  if (!rep) return '대표 채널을 찾을 수 없습니다'
  if (rep.externalSource != null) {
    return '대표 채널은 통합재고 채널(연동되지 않은 채널)만 지정할 수 있습니다'
  }

  return null
}
