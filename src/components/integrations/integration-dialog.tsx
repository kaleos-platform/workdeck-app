'use client'

import { useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { IntegrationService } from '@/lib/integrations/catalog'

export function ServiceLogo({ logo }: { logo: IntegrationService['logo'] }) {
  return (
    <span className="flex h-6 w-10 shrink-0 items-center justify-center text-muted-foreground">
      {'src' in logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" src={logo.src} className="max-h-6 max-w-10 object-contain" />
      ) : (
        <logo.icon className="h-5 w-5" aria-hidden />
      )}
    </span>
  )
}

/**
 * 서비스 팝업. 본문(카드)은 닫아도 사라지지 않게 `host` 요소에 항상 마운트돼 있고(그리드가 createPortal),
 * 열릴 때만 이 팝업 안으로 옮겨 붙인다 — 입력 중인 값과 한 번만 보이는 토큰이 유지된다.
 */
export function IntegrationDialog({
  service,
  open,
  onClose,
  host,
}: {
  service: IntegrationService
  open: boolean
  onClose: () => void
  host: HTMLElement | undefined
}) {
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && host) el.appendChild(host)
    },
    [host]
  )
  const guide = service.keyGuide

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        // 본문은 React 트리상 그리드 아래(portal)라 Radix가 바깥 클릭으로 볼 수 있다 — host 안이면 닫지 않는다.
        onPointerDownOutside={(e) => {
          if (host?.contains(e.target as Node)) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (host?.contains(e.target as Node)) e.preventDefault()
        }}
        className="max-h-[90dvh] overflow-y-auto max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:content-start max-sm:rounded-none sm:max-w-2xl"
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ServiceLogo logo={service.logo} />
            <DialogTitle>{service.name}</DialogTitle>
          </div>
          <DialogDescription>{service.description}</DialogDescription>
        </DialogHeader>
        {guide && (
          <details className="rounded-md border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">키는 어디서 받나요?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <a
              href={guide.linkHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-primary underline-offset-4 hover:underline"
            >
              {guide.linkLabel}
            </a>
          </details>
        )}
        <div ref={attach} className="min-w-0" />
      </DialogContent>
    </Dialog>
  )
}
