import type { OnboardingDraft } from '@/lib/sc/onboarding/schemas'

export type OnboardingResourceData = {
  id: string
  kind: 'URL' | 'FILE'
  sourceUrl: string | null
  fileName: string | null
  mimeType: string | null
  status: 'PENDING' | 'DONE' | 'FAILED'
  errorMessage: string | null
  createdAt: string
}

export type BrandProfileData = {
  companyName: string
  shortDescription: string
  toneOfVoice: string[]
}

export type WizardData = {
  brandProfile: BrandProfileData | null
  logoUrl: string | null
  productCount: number
  personaCount: number
  channelCount: number
  resources: OnboardingResourceData[]
  draft: OnboardingDraft | null
  draftStatus: string | null
}

export type { OnboardingDraft }
