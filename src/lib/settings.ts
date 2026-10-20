import { db } from '../db.ts'
import type { LlmSettings } from '../types.ts'

export const DEFAULT_LLM: LlmSettings = {
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
}

const LLM_KEY = 'llm'
const LAST_PROFILE_KEY = 'lastProfileId'

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export async function getLlmSettings(): Promise<LlmSettings> {
  const row = await db.settings.get(LLM_KEY)
  if (!row) return { ...DEFAULT_LLM }
  try {
    const parsed = JSON.parse(row.value_json) as Partial<LlmSettings>
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '',
      baseURL: readString(parsed.baseURL, DEFAULT_LLM.baseURL),
      model: readString(parsed.model, DEFAULT_LLM.model),
    }
  } catch {
    return { ...DEFAULT_LLM }
  }
}

export async function saveLlmSettings(settings: LlmSettings): Promise<void> {
  await db.settings.put({
    key: LLM_KEY,
    value_json: JSON.stringify({
      apiKey: settings.apiKey.trim(),
      baseURL: settings.baseURL.trim() || DEFAULT_LLM.baseURL,
      model: settings.model.trim() || DEFAULT_LLM.model,
    }),
  })
}

export async function getLastProfileId(): Promise<string | null> {
  const row = await db.settings.get(LAST_PROFILE_KEY)
  if (!row) return null
  try {
    const value = JSON.parse(row.value_json) as unknown
    return typeof value === 'string' && value ? value : null
  } catch {
    return null
  }
}

export async function setLastProfileId(id: string): Promise<void> {
  await db.settings.put({ key: LAST_PROFILE_KEY, value_json: JSON.stringify(id) })
}
