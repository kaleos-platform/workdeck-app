// Gemini Imagen 기반 이미지 공급자.
// @google/genai v1 — client.models.generateImages({ model, prompt, config }) 사용.
// 결과 바이트만 반환. Supabase Storage 저장은 Unit 7 책임.

import { GoogleGenAI } from '@google/genai'
import type {
  GeneratedImage,
  ImageProvider,
  ImageGenerateRequest,
  ImageGenerateResult,
} from './index'

const DEFAULT_MODEL = 'imagen-4.0-generate-001'

export class GeminiImageProvider implements ImageProvider {
  readonly name = 'gemini-imagen'
  private readonly apiKey: string
  private readonly model: string

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.apiKey = opts?.apiKey ?? process.env.GOOGLE_AI_API_KEY ?? ''
    this.model = opts?.model ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey)
  }

  async generate(req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    if (!this.isConfigured()) {
      throw new Error('GOOGLE_AI_API_KEY 가 설정되지 않았습니다')
    }
    const client = new GoogleGenAI({ apiKey: this.apiKey })
    const started = Date.now()

    const response = await client.models.generateImages({
      model: this.model,
      prompt: req.prompt,
      config: {
        numberOfImages: req.numberOfImages ?? 1,
        aspectRatio: req.aspectRatio,
        negativePrompt: req.negativePrompt,
        abortSignal: req.abortSignal,
      },
    })

    const generated = response?.generatedImages ?? []
    if (generated.length === 0) {
      throw new Error('Gemini Imagen 응답에 이미지가 없습니다')
    }

    const images: GeneratedImage[] = []
    for (const g of generated) {
      const base64 = g?.image?.imageBytes
      if (!base64) continue
      images.push({
        bytes: Buffer.from(base64, 'base64'),
        mimeType: g?.image?.mimeType ?? 'image/png',
      })
    }

    if (images.length === 0) {
      throw new Error('Gemini Imagen 응답에서 디코딩 가능한 이미지가 없습니다')
    }

    return { images, model: this.model, latencyMs: Date.now() - started }
  }
}
