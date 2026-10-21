import { db, deleteProfile as deleteLocalProfile } from '../db.ts'
import type { ChartCache, ChatMessage, ChatSession, Profile } from '../types.ts'
import { ApiError, api, isOffline } from './api.ts'
import { DEFAULT_MODEL, isLlmModel, type LlmModel } from './models.ts'

const LEGACY_STATUS = 'legacyStatus'
const LEGACY_SNAPSHOT = 'legacySnapshot'
const ACCOUNT_EMAIL = 'accountEmail'

export interface AppSettings {
  email: string | null
  model: LlmModel
  lastProfileId: string | null
  offline: boolean
}

export interface LegacyPreview {
  profiles: number
  sessions: number
  messages: number
}

export interface ImportResult {
  profiles: number
  charts: number
  chat_sessions: number
  chat_messages: number
  settings: number
  skipped: number
}

interface LegacySnapshot {
  profiles: Profile[]
  charts: ChartCache[]
  sessions: ChatSession[]
  messages: ChatMessage[]
  settings: Array<{ key: string; value_json: string }>
}

type LegacyStatus = 'empty' | 'pending' | 'dismissed' | 'done'

let legacyReady: Promise<void> | null = null
let settingsCache: Promise<AppSettings> | null = null

export function sortProfiles(rows: Profile[]): Profile[] {
  return rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
}

export function sortSessions(rows: ChatSession[]): ChatSession[] {
  return rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
}

export function sortMessages(rows: ChatMessage[]): ChatMessage[] {
  return rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
}

let dbTail: Promise<void> = Promise.resolve()

export function enqueueDb<T>(task: () => Promise<T>): Promise<T> {
  const run = dbTail.then(task, task)
  dbTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function readStatus(): Promise<LegacyStatus | null> {
  const row = await db.settings.get(LEGACY_STATUS)
  if (!row) return null
  try {
    const value = JSON.parse(row.value_json) as unknown
    if (value === 'empty' || value === 'pending' || value === 'dismissed' || value === 'done') return value
  } catch {
    return null
  }
  return null
}

async function writeStatus(status: LegacyStatus): Promise<void> {
  await db.settings.put({ key: LEGACY_STATUS, value_json: JSON.stringify(status) })
}

function prepareLegacy(): Promise<void> {
  legacyReady ??= snapshotLegacy()
  return legacyReady
}

async function snapshotLegacy(): Promise<void> {
  if (await readStatus()) return
  const profiles = await db.profiles.toArray()
  const charts = await db.charts.toArray()
  const sessions = await db.chat_sessions.toArray()
  const messages = await db.chat_messages.toArray()
  const settings = await db.settings.toArray()
  if (profiles.length === 0 && sessions.length === 0 && messages.length === 0) {
    await writeStatus('empty')
    return
  }
  const snapshot: LegacySnapshot = { profiles, charts, sessions, messages, settings }
  await db.settings.put({ key: LEGACY_SNAPSHOT, value_json: JSON.stringify(snapshot) })
  await writeStatus('pending')
}

async function readSnapshot(): Promise<LegacySnapshot | null> {
  const row = await db.settings.get(LEGACY_SNAPSHOT)
  if (!row) return null
  try {
    const parsed = JSON.parse(row.value_json) as Partial<LegacySnapshot>
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      charts: Array.isArray(parsed.charts) ? parsed.charts : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      settings: Array.isArray(parsed.settings) ? parsed.settings : [],
    }
  } catch {
    return null
  }
}

export async function peekLegacy(includeDismissed = false): Promise<LegacyPreview | null> {
  await prepareLegacy()
  const status = await readStatus()
  if (status !== 'pending' && !(includeDismissed && status === 'dismissed')) return null
  const snapshot = await readSnapshot()
  if (!snapshot || snapshot.profiles.length === 0) return null
  return {
    profiles: snapshot.profiles.length,
    sessions: snapshot.sessions.length,
    messages: snapshot.messages.length,
  }
}

export async function dismissLegacy(): Promise<void> {
  await prepareLegacy()
  if ((await readStatus()) === 'pending') await writeStatus('dismissed')
}

function modelFromJson(valueJson: string | undefined): LlmModel {
  if (!valueJson) return DEFAULT_MODEL
  try {
    const parsed = JSON.parse(valueJson) as { model?: unknown }
    if (typeof parsed.model === 'string' && isLlmModel(parsed.model)) return parsed.model
  } catch {
    return DEFAULT_MODEL
  }
  return DEFAULT_MODEL
}

async function cachedSettings(): Promise<AppSettings> {
  await prepareLegacy()
  const modelRow = await db.settings.get('llm')
  const lastRow = await db.settings.get('lastProfileId')
  const emailRow = await db.settings.get(ACCOUNT_EMAIL)
  let lastProfileId: string | null = null
  if (lastRow) {
    try {
      const parsed = JSON.parse(lastRow.value_json) as unknown
      lastProfileId = typeof parsed === 'string' && parsed ? parsed : null
    } catch {
      lastProfileId = null
    }
  }
  let email: string | null = null
  if (emailRow) {
    try {
      const parsed = JSON.parse(emailRow.value_json) as unknown
      email = typeof parsed === 'string' && parsed ? parsed : null
    } catch {
      email = null
    }
  }
  return {
    email,
    model: modelFromJson(modelRow?.value_json),
    lastProfileId,
    offline: true,
  }
}

export async function persistSettings(settings: AppSettings): Promise<void> {
  await db.settings.put({ key: 'llm', value_json: JSON.stringify({ model: settings.model }) })
  if (settings.lastProfileId) {
    await db.settings.put({ key: 'lastProfileId', value_json: JSON.stringify(settings.lastProfileId) })
  }
  if (settings.email) {
    await db.settings.put({ key: ACCOUNT_EMAIL, value_json: JSON.stringify(settings.email) })
  }
}

export function loadAppSettings(): Promise<AppSettings> {
  settingsCache ??= fetchSettings()
  return settingsCache
}

async function fetchSettings(): Promise<AppSettings> {
  await prepareLegacy()
  try {
    const remote = await api<{ email: string; model: string; lastProfileId: string | null }>('/api/settings')
    const settings: AppSettings = {
      email: remote.email,
      model: isLlmModel(remote.model) ? remote.model : DEFAULT_MODEL,
      lastProfileId: remote.lastProfileId,
      offline: false,
    }
    await persistSettings(settings)
    return settings
  } catch (error) {
    if (!isOffline(error)) throw error
    return cachedSettings()
  }
}

export function invalidateSettings(): void {
  settingsCache = null
}

export async function saveModel(model: LlmModel): Promise<void> {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ model }) })
  invalidateSettings()
}

export async function setLastProfileId(id: string): Promise<void> {
  await prepareLegacy()
  await enqueueDb(() => db.settings.put({ key: 'lastProfileId', value_json: JSON.stringify(id) }))
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ lastProfileId: id }) })
    invalidateSettings()
  } catch (error) {
    if (isOffline(error)) return
    throw error
  }
}

export async function readLocalProfiles(): Promise<Profile[]> {
  await prepareLegacy()
  return sortProfiles(await db.profiles.toArray())
}

export async function pullProfiles(): Promise<Profile[]> {
  await prepareLegacy()
  const profiles = sortProfiles(await api<Profile[]>('/api/profiles'))
  await enqueueDb(() =>
    db.transaction('rw', db.profiles, db.settings, async () => {
      await db.profiles.clear()
      if (profiles.length > 0) await db.profiles.bulkPut(profiles)
      await addSyncMarkUnlocked('profiles')
    }),
  )
  return profiles
}

export async function listProfiles(): Promise<{ profiles: Profile[]; offline: boolean }> {
  try {
    return { profiles: await pullProfiles(), offline: false }
  } catch (error) {
    if (!isOffline(error)) throw error
    return { profiles: await readLocalProfiles(), offline: true }
  }
}

export async function readLocalProfile(id: string): Promise<Profile | null> {
  await prepareLegacy()
  return (await db.profiles.get(id)) ?? null
}

export async function pullProfile(id: string): Promise<Profile | null> {
  await prepareLegacy()
  try {
    const profile = await api<Profile>(`/api/profiles/${id}`)
    await enqueueDb(() => db.profiles.put(profile))
    return profile
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function getProfile(id: string): Promise<Profile | null> {
  try {
    return await pullProfile(id)
  } catch (error) {
    if (!isOffline(error)) throw error
    return readLocalProfile(id)
  }
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  await prepareLegacy()
  const saved = await api<Profile>(`/api/profiles/${profile.id}`, {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
  await enqueueDb(() => db.profiles.put(saved))
  return saved
}

export async function removeProfile(id: string): Promise<void> {
  await prepareLegacy()
  try {
    await api(`/api/profiles/${id}`, { method: 'DELETE' })
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
  }
  await enqueueDb(() => deleteLocalProfile(id))
}

export async function saveChart(chart: ChartCache): Promise<void> {
  await prepareLegacy()
  await enqueueDb(() => db.charts.put(chart))
  try {
    await api(`/api/charts/${chart.id}`, { method: 'PUT', body: JSON.stringify(chart) })
  } catch (error) {
    if (isOffline(error)) return
  }
}

export async function readLocalCharts(): Promise<ChartCache[]> {
  await prepareLegacy()
  return db.charts.toArray()
}

export async function readLocalSessions(profileId: string): Promise<ChatSession[]> {
  await prepareLegacy()
  const rows = await db.chat_sessions.where('profile_id').equals(profileId).toArray()
  return sortSessions(rows)
}

export async function pullSessions(profileId: string): Promise<ChatSession[]> {
  await prepareLegacy()
  const sessions = await api<ChatSession[]>(`/api/sessions?profile_id=${encodeURIComponent(profileId)}`)
  await enqueueDb(() =>
    db.transaction('rw', db.chat_sessions, db.settings, async () => {
      await db.chat_sessions.where('profile_id').equals(profileId).delete()
      if (sessions.length > 0) await db.chat_sessions.bulkPut(sessions)
      await addSyncMarkUnlocked(`sessions:${profileId}`)
    }),
  )
  return sessions
}

export async function listSessions(profileId: string): Promise<ChatSession[]> {
  try {
    return await pullSessions(profileId)
  } catch (error) {
    if (!isOffline(error)) throw error
    return readLocalSessions(profileId)
  }
}

export async function saveSession(session: ChatSession): Promise<ChatSession> {
  await prepareLegacy()
  const saved = await api<ChatSession>(`/api/sessions/${session.id}`, {
    method: 'PUT',
    body: JSON.stringify(session),
  })
  await enqueueDb(() => db.chat_sessions.put(saved))
  return saved
}

export async function readLocalMessages(sessionId: string): Promise<ChatMessage[]> {
  await prepareLegacy()
  const rows = await db.chat_messages.where('session_id').equals(sessionId).toArray()
  return sortMessages(rows)
}

export async function pullMessages(sessionId: string): Promise<ChatMessage[]> {
  await prepareLegacy()
  const messages = await api<ChatMessage[]>(`/api/sessions/${sessionId}/messages`)
  await enqueueDb(() =>
    db.transaction('rw', db.chat_messages, db.settings, async () => {
      await db.chat_messages.where('session_id').equals(sessionId).delete()
      if (messages.length > 0) await db.chat_messages.bulkPut(messages)
      await addSyncMarkUnlocked(`messages:${sessionId}`)
    }),
  )
  return messages
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  try {
    return await pullMessages(sessionId)
  } catch (error) {
    if (!isOffline(error)) throw error
    return readLocalMessages(sessionId)
  }
}

export async function saveMessage(message: ChatMessage): Promise<ChatMessage> {
  await prepareLegacy()
  const saved = await api<ChatMessage>(`/api/sessions/${message.session_id}/messages/${message.id}`, {
    method: 'PUT',
    body: JSON.stringify(message),
  })
  await enqueueDb(() => db.chat_messages.put(saved))
  return saved
}

export interface PendingBundle {
  profiles: Profile[]
  sessions: ChatSession[]
  messages: ChatMessage[]
}

const PENDING_KEY = 'pendingWrites'
const SYNC_KEY = 'syncMarks'

function emptyPending(): PendingBundle {
  return { profiles: [], sessions: [], messages: [] }
}

export async function readPendingBundle(): Promise<PendingBundle> {
  await prepareLegacy()
  const row = await db.settings.get(PENDING_KEY)
  if (!row) return emptyPending()
  try {
    const parsed = JSON.parse(row.value_json) as Partial<PendingBundle>
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    }
  } catch {
    return emptyPending()
  }
}

export async function writePendingBundle(bundle: PendingBundle): Promise<void> {
  await prepareLegacy()
  await enqueueDb(async () => {
    if (bundle.profiles.length === 0 && bundle.sessions.length === 0 && bundle.messages.length === 0) {
      await db.settings.delete(PENDING_KEY)
      return
    }
    await db.settings.put({ key: PENDING_KEY, value_json: JSON.stringify(bundle) })
  })
}

export async function readSyncMarks(): Promise<Set<string>> {
  await prepareLegacy()
  const row = await db.settings.get(SYNC_KEY)
  if (!row) return new Set()
  try {
    const parsed = JSON.parse(row.value_json) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

async function addSyncMarkUnlocked(mark: string): Promise<void> {
  const row = await db.settings.get(SYNC_KEY)
  const marks = new Set<string>()
  if (row) {
    try {
      const parsed = JSON.parse(row.value_json) as unknown
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') marks.add(item)
        }
      }
    } catch {
      marks.clear()
    }
  }
  marks.add(mark)
  await db.settings.put({ key: SYNC_KEY, value_json: JSON.stringify([...marks]) })
}

export async function putProfileLocal(profile: Profile): Promise<void> {
  await prepareLegacy()
  await enqueueDb(() => db.profiles.put(profile))
}

export async function putSessionLocal(session: ChatSession): Promise<void> {
  await prepareLegacy()
  await enqueueDb(() => db.chat_sessions.put(session))
}

export async function putMessageLocal(message: ChatMessage): Promise<void> {
  await prepareLegacy()
  await enqueueDb(() => db.chat_messages.put(message))
}

export async function putProfilesLocal(profiles: Profile[]): Promise<void> {
  if (profiles.length === 0) return
  await prepareLegacy()
  await enqueueDb(() => db.profiles.bulkPut(profiles))
}

export async function putSessionsLocal(sessions: ChatSession[]): Promise<void> {
  if (sessions.length === 0) return
  await prepareLegacy()
  await enqueueDb(() => db.chat_sessions.bulkPut(sessions))
}

export async function putMessagesLocal(messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return
  await prepareLegacy()
  await enqueueDb(() => db.chat_messages.bulkPut(messages))
}

export async function clearAccountCache(): Promise<void> {
  await prepareLegacy()
  await enqueueDb(() =>
    db.transaction('rw', db.profiles, db.charts, db.chat_sessions, db.chat_messages, db.settings, async () => {
      await db.profiles.clear()
      await db.charts.clear()
      await db.chat_sessions.clear()
      await db.chat_messages.clear()
      await db.settings.delete(PENDING_KEY)
      await db.settings.delete(SYNC_KEY)
      await db.settings.delete('lastProfileId')
    }),
  )
}

export async function fetchRemoteSettings(): Promise<AppSettings> {
  const remote = await api<{ email: string; model: string; lastProfileId: string | null }>('/api/settings')
  return {
    email: remote.email,
    model: isLlmModel(remote.model) ? remote.model : DEFAULT_MODEL,
    lastProfileId: remote.lastProfileId,
    offline: false,
  }
}

export async function readLocalSettings(): Promise<AppSettings> {
  return cachedSettings()
}

function publicLlm(valueJson: string): string {
  return JSON.stringify({ model: modelFromJson(valueJson) })
}

export async function importLegacy(): Promise<ImportResult> {
  await prepareLegacy()
  const snapshot = await readSnapshot()
  if (!snapshot || snapshot.profiles.length === 0) throw new Error('没有可导入的本地档案。')
  const settings = snapshot.settings
    .filter((row) => row.key === 'llm' || row.key === 'lastProfileId')
    .map((row) => ({
      key: row.key,
      value_json: row.key === 'llm' ? publicLlm(row.value_json) : row.value_json,
    }))
  const result = await api<ImportResult>('/api/import', {
    method: 'POST',
    body: JSON.stringify({
      profiles: snapshot.profiles,
      charts: snapshot.charts,
      chat_sessions: snapshot.sessions,
      chat_messages: snapshot.messages,
      settings,
    }),
  })
  await db.settings.delete(LEGACY_SNAPSHOT)
  await writeStatus('done')
  invalidateSettings()
  return result
}
