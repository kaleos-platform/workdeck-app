import { FaqSection } from '@/components/marketing/landing/faq-section'
import { HomeDecks } from './home-decks'
import { HOME_FAQ } from './home-faq'
import {
  HomeAi,
  HomeFinalCta,
  HomeHero,
  HomeProblems,
  HomeSteps,
  HomeTrustBar,
} from './home-sections'

export function HomeContent({ releasedIds }: { releasedIds: string[] }) {
  return (
    <>
      <HomeHero />
      <HomeTrustBar />
      <HomeProblems />
      <HomeAi />
      <HomeDecks releasedIds={releasedIds} />
      <HomeSteps />
      <FaqSection faq={HOME_FAQ} />
      <HomeFinalCta />
    </>
  )
}
