// Bayesian Poisson-Gamma 예측 (콜드 스타트용)
//
// 모델: 수요량 ~ Poisson(λ), λ ~ Gamma(α, β)
// Posterior: λ | data ~ Gamma(α₀ + ΣY, β₀ + N)
// 예측 평균: E[λ | data] = (α₀ + ΣY) / (β₀ + N)
//
// prior (없으면 약한 prior 사용):
//   α₀=1, β₀=1 → E[λ]=1 (weak prior, 데이터에 빠르게 수렴)
//
// 카테고리/브랜드 집계로 더 강한 prior를 주입하면 콜드 스타트 품질이 향상됨.

import type { DailyOutbound, BayesianPrior, ForecastResult } from './types'

const WEAK_PRIOR: BayesianPrior = { alpha0: 1, beta0: 1 }

export function forecastBayesian(
  history: DailyOutbound[],
  prior: BayesianPrior = WEAK_PRIOR
): ForecastResult {
  const qty = history.map((d) => d.qty)
  const n = qty.length

  const sumY = qty.reduce((s, v) => s + v, 0)

  const alphaPosterior = prior.alpha0 + sumY
  const betaPosterior = prior.beta0 + n

  // posterior mean = E[λ | data]
  const dailyAvg = alphaPosterior / betaPosterior

  // 신뢰도: 데이터가 쌓일수록 증가 (n에 따라 0.2~0.7)
  // posterior precision = β / α (변동계수 역수 근사)
  const posteriorCV = Math.sqrt(alphaPosterior) / alphaPosterior // 1/sqrt(α) 근사
  const confidence = Math.min(0.7, Math.max(0.2, 1 - posteriorCV))

  return {
    dailyAvg: Math.max(0, dailyAvg),
    model: 'BAYES',
    confidence,
    debug: {
      prior,
      sumY,
      n,
      alphaPosterior: round4(alphaPosterior),
      betaPosterior: round4(betaPosterior),
      posteriorMean: round4(dailyAvg),
    },
  }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}
