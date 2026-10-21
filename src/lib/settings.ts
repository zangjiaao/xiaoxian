import type { LlmSettings } from '../types.ts'
import { DEFAULT_MODEL, isLlmModel, type LlmModel } from './models.ts'
import { loadAppSettings, saveModel, setLastProfileId as persistLastProfileId } from './store.ts'

export const DEFAULT_LLM: LlmSettings = { model: DEFAULT_MODEL }

export async function getLlmSettings(): Promise<LlmSettings> {
  const settings = await loadAppSettings()
  return { model: settings.model }
}

export async function saveLlmSettings(settings: LlmSettings): Promise<void> {
  const model: LlmModel = isLlmModel(settings.model) ? settings.model : DEFAULT_MODEL
  await saveModel(model)
}

export async function getLastProfileId(): Promise<string | null> {
  const settings = await loadAppSettings()
  return settings.lastProfileId
}

export async function setLastProfileId(id: string): Promise<void> {
  await persistLastProfileId(id)
}

export { loadAppSettings }
