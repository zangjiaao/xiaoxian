import { DEFAULT_MODEL, isLlmModel } from '../src/lib/models.ts'
import type { ChartCache, ChatMessage, ChatSession, Profile } from '../src/types.ts'
import { HttpError, json, jsonError, readJson } from './http.ts'
import {
  assertUuid,
  parseChart,
  parseMessage,
  parseProfile,
  parseSession,
  parseSettingsPatch,
  publicModel,
} from './validate.ts'

interface Ctx {
  request: Request
  env: Env
  url: URL
  email: string
  params: Record<string, string>
}

interface ProfileRow {
  id: string
  display_name: string
  gender: string
  birth_year: number
  birth_month: number
  birth_day: number
  birth_hour: number | null
  birth_minute: number | null
  birth_place: string
  notes: string
  created_at: string
  updated_at: string
}

interface ChartRow {
  id: string
  profile_id: string
  computed_at: string
  clock_mode: string
  payload_json: string
}

interface SessionRow {
  id: string
  profile_id: string
  title: string
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  reasoning: string | null
  created_at: string
}

const PROFILE_UPSERT = `INSERT INTO profiles (
  id, user_email, display_name, gender, birth_year, birth_month, birth_day,
  birth_hour, birth_minute, birth_place, notes, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  gender = excluded.gender,
  birth_year = excluded.birth_year,
  birth_month = excluded.birth_month,
  birth_day = excluded.birth_day,
  birth_hour = excluded.birth_hour,
  birth_minute = excluded.birth_minute,
  birth_place = excluded.birth_place,
  notes = excluded.notes,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at
WHERE profiles.user_email = excluded.user_email`

const CHART_UPSERT = `INSERT INTO charts (
  id, user_email, profile_id, computed_at, clock_mode, payload_json
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  profile_id = excluded.profile_id,
  computed_at = excluded.computed_at,
  clock_mode = excluded.clock_mode,
  payload_json = excluded.payload_json
WHERE charts.user_email = excluded.user_email`

const SESSION_UPSERT = `INSERT INTO chat_sessions (
  id, user_email, profile_id, title, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  profile_id = excluded.profile_id,
  title = excluded.title,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at
WHERE chat_sessions.user_email = excluded.user_email`

const MESSAGE_UPSERT = `INSERT INTO chat_messages (
  id, user_email, session_id, role, content, reasoning, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  session_id = excluded.session_id,
  role = excluded.role,
  content = excluded.content,
  reasoning = excluded.reasoning,
  created_at = excluded.created_at
WHERE chat_messages.user_email = excluded.user_email`

function profileFrom(row: ProfileRow): Profile {
  return {
    id: row.id,
    display_name: row.display_name,
    gender: row.gender === 'female' ? 'female' : 'male',
    birth_year: row.birth_year,
    birth_month: row.birth_month,
    birth_day: row.birth_day,
    birth_hour: row.birth_hour,
    birth_minute: row.birth_minute,
    birth_place: row.birth_place,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function chartFrom(row: ChartRow): ChartCache {
  return {
    id: row.id,
    profile_id: row.profile_id,
    computed_at: row.computed_at,
    clock_mode: 'civil',
    payload_json: row.payload_json,
  }
}

function sessionFrom(row: SessionRow): ChatSession {
  return {
    id: row.id,
    profile_id: row.profile_id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function messageFrom(row: MessageRow): ChatMessage {
  const role = row.role === 'assistant' ? 'assistant' : 'user'
  return {
    id: row.id,
    session_id: row.session_id,
    role,
    content: row.content,
    ...(row.reasoning ? { reasoning: row.reasoning } : {}),
    created_at: row.created_at,
  }
}

function bindProfile(env: Env, email: string, profile: Profile): D1PreparedStatement {
  return env.DB.prepare(PROFILE_UPSERT).bind(
    profile.id,
    email,
    profile.display_name,
    profile.gender,
    profile.birth_year,
    profile.birth_month,
    profile.birth_day,
    profile.birth_hour,
    profile.birth_minute,
    profile.birth_place,
    profile.notes,
    profile.created_at,
    profile.updated_at,
  )
}

async function ownsProfile(env: Env, email: string, id: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM profiles WHERE id = ? AND user_email = ?').bind(id, email).first()
  return row != null
}

async function ownsSession(env: Env, email: string, id: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM chat_sessions WHERE id = ? AND user_email = ?')
    .bind(id, email)
    .first()
  return row != null
}

async function changed(result: D1Result): Promise<number> {
  return result.meta.changes ?? 0
}

async function commit(env: Env, statements: D1PreparedStatement[]): Promise<number> {
  let total = 0
  for (let index = 0; index < statements.length; index += 30) {
    const chunk = statements.slice(index, index + 30)
    if (chunk.length === 0) continue
    const results = await env.DB.batch(chunk)
    for (const result of results) total += await changed(result)
  }
  return total
}

async function idSet(env: Env, sql: string, email: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(sql).bind(email).all<{ id: string }>()
  return new Set(rows.results.map((row) => row.id))
}

function match(pathname: string, pattern: string): Record<string, string> | null {
  const pathParts = pathname.split('/').filter(Boolean)
  const patternParts = pattern.split('/').filter(Boolean)
  if (pathParts.length !== patternParts.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index] ?? ''
    const value = pathParts[index] ?? ''
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(value)
    else if (part !== value) return null
  }
  return params
}

async function listProfiles(ctx: Ctx): Promise<Response> {
  const rows = await ctx.env.DB.prepare(
    `SELECT id, display_name, gender, birth_year, birth_month, birth_day, birth_hour, birth_minute,
            birth_place, notes, created_at, updated_at
     FROM profiles WHERE user_email = ? ORDER BY updated_at DESC`,
  )
    .bind(ctx.email)
    .all<ProfileRow>()
  return json(rows.results.map(profileFrom))
}

async function getProfile(ctx: Ctx): Promise<Response> {
  const id = assertUuid(ctx.params.id ?? '', '档案 id')
  const row = await ctx.env.DB.prepare(
    `SELECT id, display_name, gender, birth_year, birth_month, birth_day, birth_hour, birth_minute,
            birth_place, notes, created_at, updated_at
     FROM profiles WHERE id = ? AND user_email = ?`,
  )
    .bind(id, ctx.email)
    .first<ProfileRow>()
  if (!row) return jsonError(404, '没有这份档案。')
  return json(profileFrom(row))
}

async function putProfile(ctx: Ctx): Promise<Response> {
  const profile = parseProfile(await readJson(ctx.request, 32_000), ctx.params.id ?? '')
  const owner = await ctx.env.DB.prepare('SELECT user_email FROM profiles WHERE id = ?')
    .bind(profile.id)
    .first<{ user_email: string }>()
  if (owner && owner.user_email !== ctx.email) return jsonError(404, '没有这份档案。')
  await bindProfile(ctx.env, ctx.email, profile).run()
  return json(profile)
}

async function deleteProfile(ctx: Ctx): Promise<Response> {
  const id = assertUuid(ctx.params.id ?? '', '档案 id')
  if (!(await ownsProfile(ctx.env, ctx.email, id))) return jsonError(404, '没有这份档案。')
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `DELETE FROM chat_messages WHERE user_email = ? AND session_id IN (
         SELECT id FROM chat_sessions WHERE user_email = ? AND profile_id = ?
       )`,
    ).bind(ctx.email, ctx.email, id),
    ctx.env.DB.prepare('DELETE FROM chat_sessions WHERE user_email = ? AND profile_id = ?').bind(ctx.email, id),
    ctx.env.DB.prepare('DELETE FROM charts WHERE user_email = ? AND profile_id = ?').bind(ctx.email, id),
    ctx.env.DB.prepare('DELETE FROM profiles WHERE user_email = ? AND id = ?').bind(ctx.email, id),
  ])
  return json({ ok: true })
}

async function getChart(ctx: Ctx): Promise<Response> {
  const id = assertUuid(ctx.params.id ?? '', '命盘 id')
  const row = await ctx.env.DB.prepare(
    `SELECT id, profile_id, computed_at, clock_mode, payload_json
     FROM charts WHERE id = ? AND user_email = ?`,
  )
    .bind(id, ctx.email)
    .first<ChartRow>()
  if (!row) return jsonError(404, '没有这份命盘缓存。')
  return json(chartFrom(row))
}

async function putChart(ctx: Ctx): Promise<Response> {
  const chart = parseChart(await readJson(ctx.request, 250_000), ctx.params.id ?? '')
  if (!(await ownsProfile(ctx.env, ctx.email, chart.profile_id))) return jsonError(404, '没有这份档案。')
  const owner = await ctx.env.DB.prepare('SELECT user_email FROM charts WHERE id = ?')
    .bind(chart.id)
    .first<{ user_email: string }>()
  if (owner && owner.user_email !== ctx.email) return jsonError(404, '没有这份命盘缓存。')
  await ctx.env.DB.prepare(CHART_UPSERT)
    .bind(chart.id, ctx.email, chart.profile_id, chart.computed_at, chart.clock_mode, chart.payload_json)
    .run()
  return json(chart)
}

async function deleteChart(ctx: Ctx): Promise<Response> {
  const id = assertUuid(ctx.params.id ?? '', '命盘 id')
  const result = await ctx.env.DB.prepare('DELETE FROM charts WHERE id = ? AND user_email = ?')
    .bind(id, ctx.email)
    .run()
  if ((result.meta.changes ?? 0) === 0) return jsonError(404, '没有这份命盘缓存。')
  return json({ ok: true })
}

async function listSessions(ctx: Ctx): Promise<Response> {
  const profileId = assertUuid(ctx.url.searchParams.get('profile_id') ?? '', '档案 id')
  if (!(await ownsProfile(ctx.env, ctx.email, profileId))) return json([])
  const rows = await ctx.env.DB.prepare(
    `SELECT id, profile_id, title, created_at, updated_at
     FROM chat_sessions WHERE user_email = ? AND profile_id = ? ORDER BY updated_at DESC`,
  )
    .bind(ctx.email, profileId)
    .all<SessionRow>()
  return json(rows.results.map(sessionFrom))
}

async function getSession(ctx: Ctx): Promise<Response> {
  const id = assertUuid(ctx.params.id ?? '', '会话 id')
  const row = await ctx.env.DB.prepare(
    `SELECT id, profile_id, title, created_at, updated_at
     FROM chat_sessions WHERE id = ? AND user_email = ?`,
  )
    .bind(id, ctx.email)
    .first<SessionRow>()
  if (!row) return jsonError(404, '没有这场对话。')
  return json(sessionFrom(row))
}

async function putSession(ctx: Ctx): Promise<Response> {
  const session = parseSession(await readJson(ctx.request, 16_000), ctx.params.id ?? '')
  if (!(await ownsProfile(ctx.env, ctx.email, session.profile_id))) return jsonError(404, '没有这份档案。')
  const owner = await ctx.env.DB.prepare('SELECT user_email FROM chat_sessions WHERE id = ?')
    .bind(session.id)
    .first<{ user_email: string }>()
  if (owner && owner.user_email !== ctx.email) return jsonError(404, '没有这场对话。')
  await ctx.env.DB.prepare(SESSION_UPSERT)
    .bind(session.id, ctx.email, session.profile_id, session.title, session.created_at, session.updated_at)
    .run()
  return json(session)
}

async function deleteSession(ctx: Ctx): Promise<Response> {
  const id = assertUuid(ctx.params.id ?? '', '会话 id')
  if (!(await ownsSession(ctx.env, ctx.email, id))) return jsonError(404, '没有这场对话。')
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM chat_messages WHERE user_email = ? AND session_id = ?').bind(ctx.email, id),
    ctx.env.DB.prepare('DELETE FROM chat_sessions WHERE user_email = ? AND id = ?').bind(ctx.email, id),
  ])
  return json({ ok: true })
}

async function listMessages(ctx: Ctx): Promise<Response> {
  const sessionId = assertUuid(ctx.params.id ?? '', '会话 id')
  if (!(await ownsSession(ctx.env, ctx.email, sessionId))) return jsonError(404, '没有这场对话。')
  const rows = await ctx.env.DB.prepare(
    `SELECT id, session_id, role, content, reasoning, created_at
     FROM chat_messages WHERE user_email = ? AND session_id = ? ORDER BY created_at ASC`,
  )
    .bind(ctx.email, sessionId)
    .all<MessageRow>()
  return json(rows.results.map(messageFrom))
}

async function getMessage(ctx: Ctx): Promise<Response> {
  const sessionId = assertUuid(ctx.params.id ?? '', '会话 id')
  const messageId = assertUuid(ctx.params.messageId ?? '', '消息 id')
  const row = await ctx.env.DB.prepare(
    `SELECT id, session_id, role, content, reasoning, created_at
     FROM chat_messages WHERE id = ? AND session_id = ? AND user_email = ?`,
  )
    .bind(messageId, sessionId, ctx.email)
    .first<MessageRow>()
  if (!row) return jsonError(404, '没有这条消息。')
  return json(messageFrom(row))
}

async function putMessage(ctx: Ctx): Promise<Response> {
  const message = parseMessage(
    await readJson(ctx.request, 250_000),
    ctx.params.messageId ?? '',
    ctx.params.id ?? '',
  )
  if (!(await ownsSession(ctx.env, ctx.email, message.session_id))) return jsonError(404, '没有这场对话。')
  const owner = await ctx.env.DB.prepare('SELECT user_email FROM chat_messages WHERE id = ?')
    .bind(message.id)
    .first<{ user_email: string }>()
  if (owner && owner.user_email !== ctx.email) return jsonError(404, '没有这条消息。')
  await ctx.env.DB.prepare(MESSAGE_UPSERT)
    .bind(
      message.id,
      ctx.email,
      message.session_id,
      message.role,
      message.content,
      message.reasoning ?? null,
      message.created_at,
    )
    .run()
  return json(message)
}

async function deleteMessage(ctx: Ctx): Promise<Response> {
  const sessionId = assertUuid(ctx.params.id ?? '', '会话 id')
  const messageId = assertUuid(ctx.params.messageId ?? '', '消息 id')
  const result = await ctx.env.DB.prepare(
    'DELETE FROM chat_messages WHERE id = ? AND session_id = ? AND user_email = ?',
  )
    .bind(messageId, sessionId, ctx.email)
    .run()
  if ((result.meta.changes ?? 0) === 0) return jsonError(404, '没有这条消息。')
  return json({ ok: true })
}

async function getSettings(ctx: Ctx): Promise<Response> {
  const rows = await ctx.env.DB.prepare(
    `SELECT key, value_json FROM settings WHERE user_email = ? AND key IN ('llm', 'lastProfileId')`,
  )
    .bind(ctx.email)
    .all<{ key: string; value_json: string }>()
  let model: string = DEFAULT_MODEL
  let lastProfileId: string | null = null
  for (const row of rows.results) {
    if (row.key === 'llm') model = publicModel(row.value_json)
    if (row.key === 'lastProfileId') {
      try {
        const parsed = JSON.parse(row.value_json) as unknown
        lastProfileId = typeof parsed === 'string' ? parsed : null
      } catch {
        lastProfileId = null
      }
    }
  }
  return json({ email: ctx.email, model, lastProfileId })
}

async function putSettings(ctx: Ctx): Promise<Response> {
  const patch = parseSettingsPatch(await readJson(ctx.request, 8_000))
  const now = new Date().toISOString()
  if (patch.model && isLlmModel(patch.model)) {
    await ctx.env.DB.prepare(
      `INSERT INTO settings (user_email, key, value_json, updated_at) VALUES (?, 'llm', ?, ?)
       ON CONFLICT(user_email, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
      .bind(ctx.email, JSON.stringify({ model: patch.model }), now)
      .run()
  }
  if (patch.lastProfileId === null) {
    await ctx.env.DB.prepare(`DELETE FROM settings WHERE user_email = ? AND key = 'lastProfileId'`)
      .bind(ctx.email)
      .run()
  } else if (typeof patch.lastProfileId === 'string') {
    await ctx.env.DB.prepare(
      `INSERT INTO settings (user_email, key, value_json, updated_at) VALUES (?, 'lastProfileId', ?, ?)
       ON CONFLICT(user_email, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
      .bind(ctx.email, JSON.stringify(patch.lastProfileId), now)
      .run()
  }
  return getSettings(ctx)
}

function asArray(value: unknown, label: string, max: number): unknown[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new HttpError(400, `${label}格式不对。`)
  if (value.length > max) throw new HttpError(413, `${label}太多了。`)
  return value
}

async function importData(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request, 5_000_000)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, '导入格式不对。')
  }
  const record = body as Record<string, unknown>
  let skipped = 0
  const profiles: Profile[] = []
  for (const item of asArray(record.profiles, '档案', 200)) {
    const id = typeof item === 'object' && item && 'id' in item ? String((item as { id?: unknown }).id ?? '') : ''
    try {
      profiles.push(parseProfile(item, id))
    } catch {
      skipped += 1
    }
  }
  const profileWrites = profiles.map((profile) => bindProfile(ctx.env, ctx.email, profile))
  const profileChanges = await commit(ctx.env, profileWrites)
  skipped += profiles.length - profileChanges
  const ownedProfiles = await idSet(ctx.env, 'SELECT id FROM profiles WHERE user_email = ?', ctx.email)

  const charts: ChartCache[] = []
  for (const item of asArray(record.charts, '命盘', 200)) {
    const id = typeof item === 'object' && item && 'id' in item ? String((item as { id?: unknown }).id ?? '') : ''
    try {
      const chart = parseChart(item, id)
      if (!ownedProfiles.has(chart.profile_id)) {
        skipped += 1
        continue
      }
      charts.push(chart)
    } catch {
      skipped += 1
    }
  }
  const chartChanges = await commit(
    ctx.env,
    charts.map((chart) =>
      ctx.env.DB.prepare(CHART_UPSERT).bind(
        chart.id,
        ctx.email,
        chart.profile_id,
        chart.computed_at,
        chart.clock_mode,
        chart.payload_json,
      ),
    ),
  )
  skipped += charts.length - chartChanges

  const sessions: ChatSession[] = []
  for (const item of asArray(record.chat_sessions, '会话', 500)) {
    const id = typeof item === 'object' && item && 'id' in item ? String((item as { id?: unknown }).id ?? '') : ''
    try {
      const session = parseSession(item, id)
      if (!ownedProfiles.has(session.profile_id)) {
        skipped += 1
        continue
      }
      sessions.push(session)
    } catch {
      skipped += 1
    }
  }
  const sessionChanges = await commit(
    ctx.env,
    sessions.map((session) =>
      ctx.env.DB.prepare(SESSION_UPSERT).bind(
        session.id,
        ctx.email,
        session.profile_id,
        session.title,
        session.created_at,
        session.updated_at,
      ),
    ),
  )
  skipped += sessions.length - sessionChanges
  const ownedSessions = await idSet(ctx.env, 'SELECT id FROM chat_sessions WHERE user_email = ?', ctx.email)

  const messages: ChatMessage[] = []
  for (const item of asArray(record.chat_messages, '消息', 5000)) {
    const id = typeof item === 'object' && item && 'id' in item ? String((item as { id?: unknown }).id ?? '') : ''
    const sessionId =
      typeof item === 'object' && item && 'session_id' in item
        ? String((item as { session_id?: unknown }).session_id ?? '')
        : ''
    try {
      const message = parseMessage(item, id, sessionId)
      if (!ownedSessions.has(message.session_id)) {
        skipped += 1
        continue
      }
      messages.push(message)
    } catch {
      skipped += 1
    }
  }
  const messageChanges = await commit(
    ctx.env,
    messages.map((message) =>
      ctx.env.DB.prepare(MESSAGE_UPSERT).bind(
        message.id,
        ctx.email,
        message.session_id,
        message.role,
        message.content,
        message.reasoning ?? null,
        message.created_at,
      ),
    ),
  )
  skipped += messages.length - messageChanges

  const now = new Date().toISOString()
  const settingWrites: D1PreparedStatement[] = []
  let settingCount = 0
  for (const item of asArray(record.settings, '设置', 20)) {
    if (typeof item !== 'object' || item === null) {
      skipped += 1
      continue
    }
    const row = item as { key?: unknown; value_json?: unknown }
    if (row.key === 'llm' && typeof row.value_json === 'string') {
      const model = publicModel(row.value_json)
      settingWrites.push(
        ctx.env.DB.prepare(
          `INSERT INTO settings (user_email, key, value_json, updated_at) VALUES (?, 'llm', ?, ?)
           ON CONFLICT(user_email, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        ).bind(ctx.email, JSON.stringify({ model }), now),
      )
      settingCount += 1
    } else if (row.key === 'lastProfileId' && typeof row.value_json === 'string') {
      try {
        const parsed = JSON.parse(row.value_json) as unknown
        if (typeof parsed !== 'string') throw new Error('id')
        assertUuid(parsed, '档案 id')
        settingWrites.push(
          ctx.env.DB.prepare(
            `INSERT INTO settings (user_email, key, value_json, updated_at) VALUES (?, 'lastProfileId', ?, ?)
             ON CONFLICT(user_email, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
          ).bind(ctx.email, JSON.stringify(parsed), now),
        )
        settingCount += 1
      } catch {
        skipped += 1
      }
    } else {
      skipped += 1
    }
  }
  await commit(ctx.env, settingWrites)
  return json({
    profiles: profileChanges,
    charts: chartChanges,
    chat_sessions: sessionChanges,
    chat_messages: messageChanges,
    settings: settingCount,
    skipped,
  })
}

const routes: Array<{ method: string; pattern: string; handle: (ctx: Ctx) => Promise<Response> }> = [
  { method: 'GET', pattern: '/api/me', handle: (ctx) => Promise.resolve(json({ email: ctx.email })) },
  { method: 'GET', pattern: '/api/profiles', handle: listProfiles },
  { method: 'GET', pattern: '/api/profiles/:id', handle: getProfile },
  { method: 'PUT', pattern: '/api/profiles/:id', handle: putProfile },
  { method: 'DELETE', pattern: '/api/profiles/:id', handle: deleteProfile },
  { method: 'GET', pattern: '/api/charts/:id', handle: getChart },
  { method: 'PUT', pattern: '/api/charts/:id', handle: putChart },
  { method: 'DELETE', pattern: '/api/charts/:id', handle: deleteChart },
  { method: 'GET', pattern: '/api/sessions', handle: listSessions },
  { method: 'GET', pattern: '/api/sessions/:id', handle: getSession },
  { method: 'PUT', pattern: '/api/sessions/:id', handle: putSession },
  { method: 'DELETE', pattern: '/api/sessions/:id', handle: deleteSession },
  { method: 'GET', pattern: '/api/sessions/:id/messages', handle: listMessages },
  { method: 'GET', pattern: '/api/sessions/:id/messages/:messageId', handle: getMessage },
  { method: 'PUT', pattern: '/api/sessions/:id/messages/:messageId', handle: putMessage },
  { method: 'DELETE', pattern: '/api/sessions/:id/messages/:messageId', handle: deleteMessage },
  { method: 'GET', pattern: '/api/settings', handle: getSettings },
  { method: 'PUT', pattern: '/api/settings', handle: putSettings },
  { method: 'POST', pattern: '/api/import', handle: importData },
]

export async function handleData(request: Request, env: Env, url: URL, email: string): Promise<Response> {
  let pathMatched = false
  for (const route of routes) {
    const params = match(url.pathname, route.pattern)
    if (!params) continue
    pathMatched = true
    if (route.method !== request.method) continue
    return route.handle({ request, env, url, email, params })
  }
  if (pathMatched) return jsonError(405, '这个地址不支持该方法。')
  return jsonError(404, '没有这个接口。')
}
