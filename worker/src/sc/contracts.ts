// 워커 ↔ 웹앱 /api/sc/jobs/worker 응답 contract.
// 이 파일은 worker 측 강 타입 단일 진실 — runner 에서 c.deployment / c.credential 등을
// `unknown` 으로 다루지 않도록 분리.
//
// 웹앱(app/api/sc/jobs/worker/route.ts) 응답이 변경되면 이 파일도 동기화해야 한다.
// PublishContext / CollectContext (publishers·collectors/index.ts) 와 평탄화 매핑을 공유.

import type { PublishContext } from './publishers/index.js'
import type { CollectContext } from './collectors/index.js'

export type WorkerJobKind = 'PUBLISH' | 'COLLECT_METRIC' | 'INSIGHT_SWEEP'

export type WorkerJobMeta = {
  id: string
  kind: WorkerJobKind
  targetId: string | null
  payload: unknown
  attempts: number
}

// 웹앱은 Prisma include (deployment + content + assets + channel) 의 전체 row 를 보내므로
// PublishContext / CollectContext 양쪽이 요구하는 모든 필드를 포함한다.
// runner 측은 envelope 을 PublishContext / CollectContext 로 좁혀서 사용.
export type DeploymentEnvelope = PublishContext['deployment'] &
  CollectContext['deployment'] & {
    channel: PublishContext['channel'] & CollectContext['channel']
    content: PublishContext['content']
  }

export type WorkerJobResponse = {
  job: WorkerJobMeta
  deployment?: DeploymentEnvelope
  credential?: PublishContext['credential']
  assets?: PublishContext['assets']
  deploymentUrl?: string
}
