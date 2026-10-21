import { isValidCivilDate } from '../src/lib/birth.ts'
import { isLlmModel } from '../src/lib/models.ts'
import type { ChartCache, ChatMessage, ChatSession, Profile } from '../src/types.ts'
import { HttpError } from './http.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/

export function assertUuid(value: string, label = 'id'): string {
  if (!UUID_RE.test(value)) throw new HttpError(400, `${label}不是有效 id。`)
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${label}格式不对。`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `${label}格式不对。`)
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) throw new HttpError(400, `${label}长度不对。`)
  return trimmed
}

function int(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${label}不合法。`)
  }
  return value
}

function nullableInt(value: unknown, label: string, min: number, max: number): number | null {
  if (value == null) return null
  return int(value, label, min, max)
}

function iso(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${label}需要是 UTC 时间。`)
  }
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], message: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  throw new HttpError(400, message)
}

export function parseProfile(input: unknown, id: string): Profile {
  const profileId = assertUuid(id, '档案 id')
  const body = record(input, '档案')
  if (body.id != null && body.id !== profileId) throw new HttpError(400, '档案 id 不一致。')
  const display_name = text(body.display_name, '称呼', 1, 40)
  const gender = oneOf(body.gender, ['male', 'female'] as const, '性别需要是 male 或 female。')
  const birth_year = int(body.birth_year, '年份', 1900, 2100)
  const birth_month = int(body.birth_month, '月份', 1, 12)
  const birth_day = int(body.birth_day, '日期', 1, 31)
  if (!isValidCivilDate(birth_year, birth_month, birth_day)) {
    throw new HttpError(400, '这一天在公历里不存在。')
  }
  const birth_hour = nullableInt(body.birth_hour, '小时', 0, 23)
  let birth_minute = nullableInt(body.birth_minute, '分钟', 0, 59)
  if (birth_hour == null && birth_minute != null) throw new HttpError(400, '填了分钟就要填小时。')
  if (birth_hour != null && birth_minute == null) birth_minute = 0
  return {
    id: profileId,
    display_name,
    gender,
    birth_year,
    birth_month,
    birth_day,
    birth_hour,
    birth_minute,
    birth_place: text(body.birth_place ?? '', '出生地', 0, 80),
    notes: text(body.notes ?? '', '备注', 0, 500),
    created_at: iso(body.created_at, 'created_at'),
    updated_at: iso(body.updated_at, 'updated_at'),
  }
}

export function parseSession(input: unknown, id: string): ChatSession {
  const sessionId = assertUuid(id, '会话 id')
  const body = record(input, '会话')
  if (body.id != null && body.id !== sessionId) throw new HttpError(400, '会话 id 不一致。')
  return {
    id: sessionId,
    profile_id: assertUuid(String(body.profile_id ?? ''), '档案 id'),
    title: text(body.title, '标题', 1, 80),
    created_at: iso(body.created_at, 'created_at'),
    updated_at: iso(body.updated_at, 'updated_at'),
  }
}

export function parseMessage(input: unknown, id: string, sessionId: string): ChatMessage {
  const messageId = assertUuid(id, '消息 id')
  const ownedSession = assertUuid(sessionId, '会话 id')
  const body = record(input, '消息')
  if (body.id != null && body.id !== messageId) throw new HttpError(400, '消息 id 不一致。')
  if (body.session_id != null && body.session_id !== ownedSession) {
    throw new HttpError(400, '会话 id 不一致。')
  }
  const role = oneOf(body.role, ['user', 'assistant'] as const, '消息角色不对。')
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 100_000) {
    throw new HttpError(400, '消息内容不对。')
  }
  let reasoning: string | undefined
  if (typeof body.reasoning === 'string' && body.reasoning.trim()) {
    if (body.reasoning.length > 100_000) throw new HttpError(400, '思考过程太长了。')
    reasoning = body.reasoning
  }
  return {
    id: messageId,
    session_id: ownedSession,
    role,
    content: body.content,
    ...(reasoning ? { reasoning } : {}),
    created_at: iso(body.created_at, 'created_at'),
  }
}

export function parseChart(input: unknown, id: string): ChartCache {
  const chartId = assertUuid(id, '命盘 id')
  const body = record(input, '命盘')
  if (body.id != null && body.id !== chartId) throw new HttpError(400, '命盘 id 不一致。')
  if (body.clock_mode !== 'civil') throw new HttpError(400, '只接受 civil 钟表模式。')
  if (typeof body.payload_json !== 'string' || body.payload_json.length > 200_000) {
    throw new HttpError(400, '命盘内容不对。')
  }
  try {
    const payload = JSON.parse(body.payload_json) as unknown
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('payload')
    }
  } catch {
    throw new HttpError(400, '命盘内容不是 JSON。')
  }
  return {
    id: chartId,
    profile_id: assertUuid(String(body.profile_id ?? ''), '档案 id'),
    computed_at: iso(body.computed_at, 'computed_at'),
    clock_mode: 'civil',
    payload_json: body.payload_json,
  }
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function parseChatRequest(input: unknown, fallbackModel: string): { model: string; messages: ChatTurn[] } {
  const body = record(input, '聊天')
  let model = fallbackModel.trim() || 'deepseek-chat'
  if (typeof body.model === 'string' && body.model.trim()) model = body.model.trim()
  if (!isLlmModel(model)) throw new HttpError(400, '模型只能是 deepseek-chat 或 deepseek-reasoner。')
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new HttpError(400, '缺少对话内容。')
  }
  if (body.messages.length > 48) throw new HttpError(400, '对话太长了，先开一个新对话。')
  const messages: ChatTurn[] = []
  let total = 0
  for (const item of body.messages) {
    const message = record(item, '对话')
    const role = oneOf(message.role, ['system', 'user', 'assistant'] as const, '对话角色不对。')
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw new HttpError(400, '有一条空消息。')
    }
    if (message.content.length > 120_000) throw new HttpError(400, '有一条消息太长了。')
    total += message.content.length
    if (total > 400_000) throw new HttpError(400, '这次发送的内容太长了。')
    messages.push({ role, content: message.content })
  }
  return { model, messages }
}

export function parseSettingsPatch(input: unknown): { model?: string; lastProfileId?: string | null } {
  const body = record(input, '设置')
  const patch: { model?: string; lastProfileId?: string | null } = {}
  if (body.model != null) {
    if (typeof body.model !== 'string' || !isLlmModel(body.model.trim())) {
      throw new HttpError(400, '模型只能是 deepseek-chat 或 deepseek-reasoner。')
    }
    patch.model = body.model.trim()
  }
  if (body.lastProfileId === null) patch.lastProfileId = null
  else if (body.lastProfileId != null) {
    if (typeof body.lastProfileId !== 'string') throw new HttpError(400, '最近档案 id 不对。')
    patch.lastProfileId = assertUuid(body.lastProfileId, '档案 id')
  }
  if (patch.model == null && patch.lastProfileId === undefined) {
    throw new HttpError(400, '没有要保存的设置。')
  }
  return patch
}

export function publicModel(valueJson: string): string {
  try {
    const parsed = JSON.parse(valueJson) as { model?: unknown }
    if (typeof parsed.model === 'string' && isLlmModel(parsed.model)) return parsed.model
  } catch {
    return 'deepseek-chat'
  }
  return 'deepseek-chat'
}
