export const ALLOWED_MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const

export type LlmModel = (typeof ALLOWED_MODELS)[number]

export const DEFAULT_MODEL: LlmModel = 'deepseek-chat'

export function isLlmModel(value: string): value is LlmModel {
  return (ALLOWED_MODELS as readonly string[]).includes(value)
}
