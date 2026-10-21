// 跨路由常驻内存：先用 Dexie 渲染，再在后台刷新 D1。切页不重置进行中的流式回复。
import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { ChartCache, ChartPayload, ChatMessage, ChatSession, Profile } from '../types.ts'
import { isOffline } from './api.ts'
import { computeChart } from './chart.ts'
import { createId, nowIso } from './id.ts'
import { streamChat } from './llm.ts'
import { DEFAULT_MODEL, type LlmModel } from './models.ts'
import { buildSystemPrompt } from './prompt.ts'
import {
  clearAccountCache,
  fetchRemoteSettings,
  persistSettings,
  pullMessages,
  pullProfile,
  pullProfiles,
  pullSessions,
  putMessageLocal,
  putMessagesLocal,
  putProfileLocal,
  putProfilesLocal,
  putSessionLocal,
  putSessionsLocal,
  readLocalCharts,
  readLocalMessages,
  readLocalProfile,
  readLocalProfiles,
  readLocalSessions,
  readLocalSettings,
  readPendingBundle,
  readSyncMarks,
  removeProfile,
  saveMessage,
  saveModel,
  saveChart,
  saveProfile,
  saveSession,
  setLastProfileId,
  sortMessages,
  sortProfiles,
  sortSessions,
  writePendingBundle,
  type AppSettings,
  type PendingBundle,
} from './store.ts'

export interface ChartRecord {
  updatedAt: string
  day: string
  payload: ChartPayload
}

export interface ChatView {
  profileId: string | null
  sessionByProfile: Record<string, string | null | undefined>
  draftByProfile: Record<string, string>
  error: string
}

export interface StreamView {
  profileId: string
  sessionId: string
  content: string
  reasoning: string
  busy: boolean
}

type ReadyState = 'ready' | 'error'

export interface Snapshot {
  booted: boolean
  settings: AppSettings | null
  settingsStatus: 'loading' | 'ready'
  profiles: Profile[] | null
  profilesStatus: 'loading' | 'ready' | 'error'
  profilesError: string | null
  offline: boolean
  syncNotice: string | null
  sessions: Record<string, ChatSession[] | undefined>
  sessionsStatus: Record<string, ReadyState | undefined>
  messages: Record<string, ChatMessage[] | undefined>
  messagesStatus: Record<string, ReadyState | undefined>
  charts: Record<string, ChartRecord | undefined>
  profileMiss: Record<string, boolean | undefined>
  chat: ChatView
  stream: StreamView | null
}

interface ScrollPoint {
  top: number
  followBottom: boolean
}

const listeners = new Set<() => void>()
const pendingProfiles = new Map<string, Profile>()
const pendingSessions = new Map<string, ChatSession>()
const pendingMessages = new Map<string, ChatMessage>()
const profilePins = new Map<string, { item: Profile; at: number }>()
const sessionPins = new Map<string, { item: ChatSession; at: number }>()
const messagePins = new Map<string, { item: ChatMessage; at: number }>()
const profileChains = new Map<string, Promise<void>>()
const sessionChains = new Map<string, Promise<void>>()
const messageChains = new Map<string, Promise<void>>()
const flights = new Map<string, Promise<void>>()
const scrollPoints = new Map<string, ScrollPoint>()

let snapshot: Snapshot = emptySnapshot()
let warm: Promise<void> | null = null
let warmDone = false
let abortController: AbortController | null = null
let streamGeneration = 0
let resolveAccount = () => {}
const accountKnown = new Promise<void>((resolve) => {
  resolveAccount = resolve
})

function markAccountKnown() {
  resolveAccount()
}

function emptyChat(): ChatView {
  return { profileId: null, sessionByProfile: {}, draftByProfile: {}, error: '' }
}

function emptySnapshot(): Snapshot {
  return {
    booted: false,
    settings: null,
    settingsStatus: 'loading',
    profiles: null,
    profilesStatus: 'loading',
    profilesError: null,
    offline: false,
    syncNotice: null,
    sessions: {},
    sessionsStatus: {},
    messages: {},
    messagesStatus: {},
    charts: {},
    profileMiss: {},
    chat: emptyChat(),
    stream: null,
  }
}

function emit() {
  for (const listener of listeners) listener()
}

function update(mutate: (current: Snapshot) => Snapshot) {
  snapshot = mutate(snapshot)
  emit()
}

export function getSnapshot(): Snapshot {
  return snapshot
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMemorySelector<T>(selector: (state: Snapshot) => T): T {
  const cacheRef = useRef<{ snap: Snapshot; select: (state: Snapshot) => T; selected: T } | null>(null)
  const getSelection = useCallback(() => {
    const current = snapshot
    const cache = cacheRef.current
    if (cache && cache.snap === current && cache.select === selector) return cache.selected
    const selected = selector(current)
    if (cache && cache.select === selector && Object.is(cache.selected, selected)) {
      cacheRef.current = { snap: current, select: selector, selected: cache.selected }
      return cache.selected
    }
    cacheRef.current = { snap: current, select: selector, selected }
    return selected
  }, [selector])
  return useSyncExternalStore(subscribe, getSelection, getSelection)
}

export function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function rememberScroll(key: string, top: number, followBottom: boolean) {
  scrollPoints.set(key, { top, followBottom })
}

export function readScroll(key: string): ScrollPoint {
  return scrollPoints.get(key) ?? { top: 0, followBottom: true }
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function hasPending(): boolean {
  return pendingProfiles.size > 0 || pendingSessions.size > 0 || pendingMessages.size > 0
}

function bundle(): PendingBundle {
  return {
    profiles: [...pendingProfiles.values()],
    sessions: [...pendingSessions.values()],
    messages: [...pendingMessages.values()],
  }
}

function loadPending(next: PendingBundle) {
  pendingProfiles.clear()
  pendingSessions.clear()
  pendingMessages.clear()
  for (const profile of next.profiles) pendingProfiles.set(profile.id, profile)
  for (const session of next.sessions) pendingSessions.set(session.id, session)
  for (const message of next.messages) pendingMessages.set(message.id, message)
}

function mergeProfiles(remote: Profile[], pending: Iterable<Profile>): Profile[] {
  const map = new Map(remote.map((item) => [item.id, item]))
  for (const item of pending) map.set(item.id, item)
  return sortProfiles([...map.values()])
}

function mergeSessions(remote: ChatSession[], pending: Iterable<ChatSession>): ChatSession[] {
  const map = new Map(remote.map((item) => [item.id, item]))
  for (const item of pending) map.set(item.id, item)
  return sortSessions([...map.values()])
}

function mergeMessages(remote: ChatMessage[], pending: Iterable<ChatMessage>): ChatMessage[] {
  const map = new Map(remote.map((item) => [item.id, item]))
  for (const item of pending) map.set(item.id, item)
  return sortMessages([...map.values()])
}

function pendingSessionsFor(profileId: string): ChatSession[] {
  return [...pendingSessions.values()].filter((session) => session.profile_id === profileId)
}

function pendingMessagesFor(sessionId: string): ChatMessage[] {
  return [...pendingMessages.values()].filter((message) => message.session_id === sessionId)
}

function heldProfiles(remote: Profile[], started: number): Profile[] {
  const ids = new Set(remote.map((item) => item.id))
  const held = [...profilePins.values()]
    .filter((pin) => !ids.has(pin.item.id) && pin.at > started)
    .map((pin) => pin.item)
  for (const item of remote) profilePins.delete(item.id)
  return [...pendingProfiles.values(), ...held]
}

function heldSessions(profileId: string, remote: ChatSession[], started: number): ChatSession[] {
  const ids = new Set(remote.map((item) => item.id))
  const held = [...sessionPins.values()]
    .filter((pin) => pin.item.profile_id === profileId && !ids.has(pin.item.id) && pin.at > started)
    .map((pin) => pin.item)
  for (const item of remote) sessionPins.delete(item.id)
  return [...pendingSessionsFor(profileId), ...held]
}

function heldMessages(sessionId: string, remote: ChatMessage[], started: number): ChatMessage[] {
  const ids = new Set(remote.map((item) => item.id))
  const held = [...messagePins.values()]
    .filter((pin) => pin.item.session_id === sessionId && !ids.has(pin.item.id) && pin.at > started)
    .map((pin) => pin.item)
  for (const item of remote) messagePins.delete(item.id)
  return [...pendingMessagesFor(sessionId), ...held]
}

function flight(key: string, task: () => Promise<void>): Promise<void> {
  const existing = flights.get(key)
  if (existing) return existing
  const job = task().finally(() => {
    if (flights.get(key) === job) flights.delete(key)
  })
  flights.set(key, job)
  return job
}

function enqueueChain(chains: Map<string, Promise<void>>, id: string, task: () => Promise<void>): Promise<void> {
  const previous = chains.get(id) ?? Promise.resolve()
  const job = previous.then(task, task)
  chains.set(
    id,
    job.then(
      () => undefined,
      () => undefined,
    ),
  )
  return job
}

function resetUserMemory() {
  streamGeneration += 1
  abortController?.abort()
  abortController = null
  pendingProfiles.clear()
  pendingSessions.clear()
  pendingMessages.clear()
  profilePins.clear()
  sessionPins.clear()
  messagePins.clear()
  scrollPoints.clear()
  update((current) => ({
    ...current,
    profiles: null,
    profilesStatus: 'loading',
    profilesError: null,
    sessions: {},
    sessionsStatus: {},
    messages: {},
    messagesStatus: {},
    charts: {},
    profileMiss: {},
    stream: null,
    syncNotice: null,
    chat: emptyChat(),
    settings: current.settings ? { ...current.settings, lastProfileId: null } : current.settings,
  }))
}

function seedCharts(rows: ChartCache[]): Snapshot['charts'] {
  const charts: Snapshot['charts'] = {}
  const day = dayKey()
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as ChartPayload
      if (!payload || typeof payload !== 'object') continue
      charts[row.profile_id] = { updatedAt: '', day, payload }
    } catch {
      continue
    }
  }
  return charts
}

async function hydrateFromDexie() {
  const [settings, profiles, marks, pending, charts] = await Promise.all([
    readLocalSettings(),
    readLocalProfiles(),
    readSyncMarks(),
    readPendingBundle(),
    readLocalCharts(),
  ])
  loadPending(pending)
  const mergedProfiles = mergeProfiles(profiles, pendingProfiles.values())
  const profilesReady = mergedProfiles.length > 0 || marks.has('profiles')
  const sessions: Snapshot['sessions'] = {}
  const sessionsStatus: Snapshot['sessionsStatus'] = {}
  const messages: Snapshot['messages'] = {}
  const messagesStatus: Snapshot['messagesStatus'] = {}
  const chat = emptyChat()
  const profileId = settings.lastProfileId ?? mergedProfiles[0]?.id ?? null
  if (profileId) {
    const localSessions = mergeSessions(await readLocalSessions(profileId), pendingSessionsFor(profileId))
    if (localSessions.length > 0 || marks.has(`sessions:${profileId}`)) {
      sessions[profileId] = localSessions
      sessionsStatus[profileId] = 'ready'
      chat.profileId = profileId
      const pendingOpen = pendingSessionsFor(profileId).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0]
      const sessionId = pendingOpen?.id ?? localSessions[0]?.id ?? null
      chat.sessionByProfile[profileId] = sessionId
      if (sessionId) {
        const localMessages = mergeMessages(await readLocalMessages(sessionId), pendingMessagesFor(sessionId))
        if (localMessages.length > 0 || marks.has(`messages:${sessionId}`)) {
          messages[sessionId] = localMessages
          messagesStatus[sessionId] = 'ready'
        }
      }
    }
  }
  update((current) => ({
    ...current,
    booted: true,
    settings: { ...settings, offline: false },
    settingsStatus: 'ready',
    profiles: profilesReady ? mergedProfiles : current.profiles,
    profilesStatus: profilesReady ? 'ready' : current.profilesStatus,
    sessions: { ...current.sessions, ...sessions },
    sessionsStatus: { ...current.sessionsStatus, ...sessionsStatus },
    messages: { ...current.messages, ...messages },
    messagesStatus: { ...current.messagesStatus, ...messagesStatus },
    charts: { ...seedCharts(charts), ...current.charts },
    chat: current.chat.profileId ? current.chat : chat,
  }))
}

async function refreshSettings() {
  try {
    await flight('settings', async () => {
    try {
      const remote = await fetchRemoteSettings()
      const previous = snapshot.settings?.email ?? null
      if (previous && remote.email && !sameEmail(previous, remote.email)) {
        await clearAccountCache()
        resetUserMemory()
      }
      await persistSettings(remote)
      update((current) => ({
        ...current,
        settings: remote,
        settingsStatus: 'ready',
        offline: false,
      }))
    } catch (error) {
      if (isOffline(error)) {
        update((current) => ({ ...current, offline: true, settingsStatus: 'ready' }))
        return
      }
      update((current) => ({
        ...current,
        settingsStatus: 'ready',
        syncNotice: current.settings ? current.syncNotice : errorText(error, '设置暂时打不开。'),
      }))
    }
  })
  } finally {
    markAccountKnown()
  }
}

async function refreshProfiles() {
  await flight('profiles', async () => {
    const started = Date.now()
    try {
      const remote = await pullProfiles()
      const extras = heldProfiles(remote, started)
      const merged = mergeProfiles(remote, extras)
      update((current) => ({
        ...current,
        profiles: merged,
        profilesStatus: 'ready',
        profilesError: null,
        offline: false,
        syncNotice: hasPending() ? current.syncNotice : null,
      }))
      await putProfilesLocal(extras)
    } catch (error) {
      const offline = isOffline(error)
      update((current) => {
        if (current.profiles) {
          return { ...current, offline: offline || current.offline, profilesStatus: 'ready' }
        }
        return {
          ...current,
          offline: offline || current.offline,
          profilesStatus: 'error',
          profilesError: errorText(error, offline ? '连不上云端。' : '档案暂时打不开。'),
        }
      })
    }
  })
}

function settleSession(profileId: string, sessions: ChatSession[]) {
  if (snapshot.stream?.busy && snapshot.stream.profileId === profileId) {
    const sessionId = snapshot.stream.sessionId
    if (snapshot.chat.sessionByProfile[profileId] !== sessionId) {
      update((current) => ({
        ...current,
        chat: {
          ...current.chat,
          profileId,
          sessionByProfile: { ...current.chat.sessionByProfile, [profileId]: sessionId },
        },
      }))
    }
    return
  }
  const remembered = snapshot.chat.sessionByProfile[profileId]
  if (remembered === undefined) {
    const next = sessions[0]?.id ?? null
    update((current) => ({
      ...current,
      chat: {
        ...current.chat,
        profileId: current.chat.profileId ?? profileId,
        sessionByProfile: { ...current.chat.sessionByProfile, [profileId]: next },
      },
    }))
    if (next) ensureMessages(next)
    return
  }
  if (
    remembered &&
    !sessions.some((session) => session.id === remembered) &&
    !pendingSessions.has(remembered) &&
    !sessionPins.has(remembered)
  ) {
    const next = sessions[0]?.id ?? null
    update((current) => ({
      ...current,
      chat: {
        ...current.chat,
        sessionByProfile: { ...current.chat.sessionByProfile, [profileId]: next },
      },
    }))
    if (next) ensureMessages(next)
  }
}

function publishSessions(profileId: string, sessions: ChatSession[]) {
  update((current) => ({
    ...current,
    sessions: { ...current.sessions, [profileId]: sessions },
    sessionsStatus: { ...current.sessionsStatus, [profileId]: 'ready' },
  }))
  settleSession(profileId, sessions)
}

async function refreshSessions(profileId: string) {
  const started = Date.now()
  try {
    const remote = await pullSessions(profileId)
    const extras = heldSessions(profileId, remote, started)
    const merged = mergeSessions(remote, extras)
    publishSessions(profileId, merged)
    await putSessionsLocal(extras)
    update((current) => ({ ...current, offline: false }))
  } catch (error) {
    const offline = isOffline(error)
    const local = snapshot.sessions[profileId]
    if (local) {
      update((current) => ({
        ...current,
        offline: offline || current.offline,
        sessionsStatus: { ...current.sessionsStatus, [profileId]: 'ready' },
      }))
      return
    }
    if (offline) {
      const cached = mergeSessions(await readLocalSessions(profileId), pendingSessionsFor(profileId))
      if (cached.length > 0) {
        publishSessions(profileId, cached)
        update((current) => ({ ...current, offline: true }))
        return
      }
    }
    update((current) => ({
      ...current,
      offline: offline || current.offline,
      sessionsStatus: { ...current.sessionsStatus, [profileId]: 'error' },
      chat: {
        ...current.chat,
        error: current.chat.error || errorText(error, '对话列表暂时打不开。'),
      },
    }))
  }
}

export function ensureSessions(profileId: string) {
  void flight(`sessions:${profileId}`, async () => {
    if (snapshot.sessionsStatus[profileId] !== 'ready') {
      const marks = await readSyncMarks()
      const local = mergeSessions(await readLocalSessions(profileId), pendingSessionsFor(profileId))
      if (local.length > 0 || marks.has(`sessions:${profileId}`)) publishSessions(profileId, local)
    }
    await refreshSessions(profileId)
  })
}

function publishMessages(sessionId: string, messages: ChatMessage[]) {
  update((current) => ({
    ...current,
    messages: { ...current.messages, [sessionId]: messages },
    messagesStatus: { ...current.messagesStatus, [sessionId]: 'ready' },
  }))
}

async function refreshMessages(sessionId: string) {
  const started = Date.now()
  try {
    const remote = await pullMessages(sessionId)
    const extras = heldMessages(sessionId, remote, started)
    const merged = mergeMessages(remote, extras)
    publishMessages(sessionId, merged)
    await putMessagesLocal(extras)
    update((current) => ({ ...current, offline: false }))
  } catch (error) {
    const offline = isOffline(error)
    if (snapshot.messages[sessionId]) {
      update((current) => ({ ...current, offline: offline || current.offline }))
      return
    }
    if (offline) {
      const cached = mergeMessages(await readLocalMessages(sessionId), pendingMessagesFor(sessionId))
      if (cached.length > 0) {
        publishMessages(sessionId, cached)
        update((current) => ({ ...current, offline: true }))
        return
      }
    }
    update((current) => ({
      ...current,
      offline: offline || current.offline,
      messagesStatus: { ...current.messagesStatus, [sessionId]: 'error' },
      chat: {
        ...current.chat,
        error: current.chat.error || errorText(error, '这段对话暂时打不开。'),
      },
    }))
  }
}

export function ensureMessages(sessionId: string) {
  void flight(`messages:${sessionId}`, async () => {
    if (snapshot.messagesStatus[sessionId] !== 'ready') {
      const marks = await readSyncMarks()
      const local = mergeMessages(await readLocalMessages(sessionId), pendingMessagesFor(sessionId))
      if (local.length > 0 || marks.has(`messages:${sessionId}`)) publishMessages(sessionId, local)
    }
    await refreshMessages(sessionId)
  })
}

function adoptProfile(profile: Profile) {
  if (pendingProfiles.has(profile.id)) return
  update((current) => ({
    ...current,
    profiles: sortProfiles([profile, ...(current.profiles ?? []).filter((item) => item.id !== profile.id)]),
    profilesStatus: 'ready',
    profilesError: null,
    profileMiss: { ...current.profileMiss, [profile.id]: false },
  }))
}

export function ensureProfile(id: string) {
  void flight(`profile:${id}`, async () => {
    const local = snapshot.profiles?.find((item) => item.id === id) ?? (await readLocalProfile(id))
    if (local) adoptProfile(local)
    if (pendingProfiles.has(id)) return
    try {
      const remote = await pullProfile(id)
      if (pendingProfiles.has(id)) return
      if (!remote) {
        if (!snapshot.profiles?.some((item) => item.id === id)) {
          update((current) => ({ ...current, profileMiss: { ...current.profileMiss, [id]: true } }))
        }
        return
      }
      adoptProfile(remote)
    } catch (error) {
      if (!snapshot.profiles?.some((item) => item.id === id)) {
        update((current) => ({
          ...current,
          profilesError: errorText(error, '档案暂时打不开。'),
          offline: isOffline(error) || current.offline,
        }))
      } else if (isOffline(error)) {
        update((current) => ({ ...current, offline: true }))
      }
    }
  })
}

async function doWarm() {
  try {
    await hydrateFromDexie()
    await refreshSettings()
  await refreshProfiles()
  const profileId =
    snapshot.settings?.lastProfileId && snapshot.profiles?.some((item) => item.id === snapshot.settings?.lastProfileId)
      ? snapshot.settings.lastProfileId
      : (snapshot.profiles?.[0]?.id ?? null)
  if (profileId) {
    await flight(`sessions:${profileId}`, async () => {
      if (snapshot.sessionsStatus[profileId] !== 'ready') {
        const marks = await readSyncMarks()
        const local = mergeSessions(await readLocalSessions(profileId), pendingSessionsFor(profileId))
        if (local.length > 0 || marks.has(`sessions:${profileId}`)) publishSessions(profileId, local)
      }
      await refreshSessions(profileId)
    })
    const chosen = snapshot.chat.sessionByProfile[profileId]
    const sessionId = chosen === undefined ? snapshot.sessions[profileId]?.[0]?.id : chosen
    if (sessionId) await flight(`messages:${sessionId}`, () => refreshKnownMessages(sessionId))
  }
    await flushPending()
  } finally {
    markAccountKnown()
  }
}

async function refreshKnownMessages(sessionId: string) {
  if (snapshot.messagesStatus[sessionId] !== 'ready') {
    const marks = await readSyncMarks()
    const local = mergeMessages(await readLocalMessages(sessionId), pendingMessagesFor(sessionId))
    if (local.length > 0 || marks.has(`messages:${sessionId}`)) publishMessages(sessionId, local)
  }
  await refreshMessages(sessionId)
}

export function warmCache(): Promise<void> {
  warm ??= doWarm()
    .catch(() => {
      update((current) => ({
        ...current,
        booted: true,
        settingsStatus: 'ready',
        settings: current.settings ?? {
          email: null,
          model: DEFAULT_MODEL,
          lastProfileId: null,
          offline: true,
        },
        profilesStatus: current.profiles ? 'ready' : 'error',
        profilesError: current.profilesError ?? (current.profiles ? null : '档案暂时打不开。'),
      }))
    })
    .finally(() => {
      warmDone = true
    })
  return warm
}

export function isCacheWarm(): boolean {
  return warmDone
}

export function retryProfiles() {
  void refreshProfiles()
}

export function refreshAfterImport() {
  void flight('import', async () => {
    await refreshSettings()
    await refreshProfiles()
  })
}

export function rememberLastProfile(id: string) {
  const current = snapshot.settings
  if (!current || current.lastProfileId !== id) {
    const next: AppSettings = current
      ? { ...current, lastProfileId: id }
      : { email: null, model: DEFAULT_MODEL, lastProfileId: id, offline: true }
    update((state) => ({ ...state, settings: next, settingsStatus: 'ready' }))
    void persistSettings(next).catch(() => undefined)
  }
  void setLastProfileId(id).catch(() => undefined)
}

export function focusProfile(profileId: string) {
  if (snapshot.chat.profileId !== profileId) {
    update((current) => ({
      ...current,
      chat: { ...current.chat, profileId, error: current.stream?.busy ? current.chat.error : '' },
    }))
  }
  rememberLastProfile(profileId)
  ensureSessions(profileId)
  const sessionId = snapshot.chat.sessionByProfile[profileId]
  if (sessionId) ensureMessages(sessionId)
}

export function selectSession(sessionId: string) {
  if (snapshot.stream?.busy) return
  const profileId = snapshot.chat.profileId
  if (!profileId || snapshot.chat.sessionByProfile[profileId] === sessionId) return
  update((current) => ({
    ...current,
    chat: {
      ...current.chat,
      error: '',
      sessionByProfile: { ...current.chat.sessionByProfile, [profileId]: sessionId },
    },
  }))
  ensureMessages(sessionId)
}

export function startNewChat() {
  if (snapshot.stream?.busy) return
  const profileId = snapshot.chat.profileId
  if (!profileId) return
  update((current) => ({
    ...current,
    chat: {
      ...current.chat,
      error: '',
      sessionByProfile: { ...current.chat.sessionByProfile, [profileId]: null },
    },
  }))
}

export function updateDraft(profileId: string, value: string) {
  if ((snapshot.chat.draftByProfile[profileId] ?? '') === value) return
  update((current) => ({
    ...current,
    chat: {
      ...current.chat,
      draftByProfile: { ...current.chat.draftByProfile, [profileId]: value },
    },
  }))
}

export function rememberChart(profile: Profile, payload: ChartPayload) {
  const day = dayKey()
  const current = snapshot.charts[profile.id]
  if (current && current.updatedAt === profile.updated_at && current.day === day && current.payload === payload) return
  update((state) => ({
    ...state,
    charts: {
      ...state.charts,
      [profile.id]: { updatedAt: profile.updated_at, day, payload },
    },
  }))
}

export async function stageProfile(profile: Profile): Promise<void> {
  pendingProfiles.set(profile.id, profile)
  update((current) => ({
    ...current,
    profiles: sortProfiles([profile, ...(current.profiles ?? []).filter((item) => item.id !== profile.id)]),
    profilesStatus: 'ready',
    profilesError: null,
    syncNotice: null,
    profileMiss: { ...current.profileMiss, [profile.id]: false },
  }))
  await putProfileLocal(profile)
  await writePendingBundle(bundle())
}

async function pushProfileBody(id: string) {
  await accountKnown
  const profile = pendingProfiles.get(id)
  if (!profile) return
  const pushedAt = profile.updated_at
  try {
    const saved = await saveProfile(profile)
    const current = pendingProfiles.get(id)
    if (!current || current.updated_at !== pushedAt) return
    pendingProfiles.delete(id)
    profilePins.set(saved.id, { item: saved, at: Date.now() })
    await writePendingBundle(bundle())
    const remembered = snapshot.charts[saved.id]
    if (remembered) {
      void saveChart({
        id: saved.id,
        profile_id: saved.id,
        computed_at: nowIso(),
        clock_mode: 'civil',
        payload_json: JSON.stringify(remembered.payload),
      })
    }
    update((state) => ({
      ...state,
      profiles: mergeProfiles(
        (state.profiles ?? []).map((item) => (item.id === saved.id ? saved : item)),
        pendingProfiles.values(),
      ),
      profilesStatus: 'ready',
      offline: false,
      syncNotice: hasPending() ? state.syncNotice : null,
    }))
  } catch (error) {
    if (pendingProfiles.get(id)?.updated_at !== pushedAt) return
    update((state) => ({
      ...state,
      offline: isOffline(error) || state.offline,
      syncNotice: errorText(error, '档案没能同步到云端，仍留在这台设备上。'),
    }))
    throw error
  }
}

export function syncProfile(id: string): Promise<void> {
  return enqueueChain(profileChains, id, () => pushProfileBody(id))
}

export async function removeProfileOptimistic(id: string): Promise<void> {
  const previousProfiles = snapshot.profiles
  const previousPending = pendingProfiles.get(id) ?? null
  const previousSessions = snapshot.sessions[id]
  const previousStatus = snapshot.sessionsStatus[id]
  const previousMessages: Record<string, ChatMessage[] | undefined> = {}
  const previousMessageStatus: Record<string, ReadyState | undefined> = {}
  const previousPendingSessions = [...pendingSessions.values()].filter((session) => session.profile_id === id)
  const previousPendingMessages = [...pendingMessages.values()].filter((message) =>
    (previousSessions ?? []).some((session) => session.id === message.session_id),
  )
  pendingProfiles.delete(id)
  for (const session of previousSessions ?? []) {
    pendingSessions.delete(session.id)
    previousMessages[session.id] = snapshot.messages[session.id]
    previousMessageStatus[session.id] = snapshot.messagesStatus[session.id]
    for (const message of snapshot.messages[session.id] ?? []) pendingMessages.delete(message.id)
  }
  update((current) => {
    const sessions = { ...current.sessions }
    const sessionsStatus = { ...current.sessionsStatus }
    const messages = { ...current.messages }
    const messagesStatus = { ...current.messagesStatus }
    for (const session of previousSessions ?? []) {
      delete messages[session.id]
      delete messagesStatus[session.id]
    }
    delete sessions[id]
    delete sessionsStatus[id]
    const charts = { ...current.charts }
    delete charts[id]
    return {
      ...current,
      profiles: (current.profiles ?? []).filter((item) => item.id !== id),
      sessions,
      sessionsStatus,
      messages,
      messagesStatus,
      charts,
      syncNotice: null,
    }
  })
  try {
    await removeProfile(id)
    profilePins.delete(id)
    for (const session of previousSessions ?? []) {
      sessionPins.delete(session.id)
      for (const message of previousMessages[session.id] ?? []) messagePins.delete(message.id)
    }
    await writePendingBundle(bundle())
  } catch (error) {
    if (previousPending) pendingProfiles.set(id, previousPending)
    for (const session of previousPendingSessions) pendingSessions.set(session.id, session)
    for (const message of previousPendingMessages) pendingMessages.set(message.id, message)
    update((current) => ({
      ...current,
      profiles: previousProfiles,
      sessions: { ...current.sessions, [id]: previousSessions },
      sessionsStatus: { ...current.sessionsStatus, [id]: previousStatus },
      messages: { ...current.messages, ...previousMessages },
      messagesStatus: { ...current.messagesStatus, ...previousMessageStatus },
      syncNotice: errorText(error, '没有删除成功，档案还在。'),
    }))
    await writePendingBundle(bundle())
  }
}

function replaceSession(session: ChatSession) {
  update((current) => {
    const list = current.sessions[session.profile_id] ?? []
    const next = sortSessions([session, ...list.filter((item) => item.id !== session.id)])
    return {
      ...current,
      sessions: { ...current.sessions, [session.profile_id]: next },
      sessionsStatus: { ...current.sessionsStatus, [session.profile_id]: 'ready' },
    }
  })
}

function stageSession(session: ChatSession) {
  pendingSessions.set(session.id, session)
  replaceSession(session)
  void putSessionLocal(session).catch(() => undefined)
  void writePendingBundle(bundle()).catch(() => undefined)
}

async function pushSessionBody(id: string) {
  await accountKnown
  const session = pendingSessions.get(id)
  if (!session) return
  const pushedAt = session.updated_at
  try {
    await syncProfile(session.profile_id)
  } catch (error) {
    if (pendingSessions.get(id)?.updated_at !== pushedAt) return
    update((current) => ({
      ...current,
      syncNotice: current.syncNotice || errorText(error, '对话没能同步到云端，仍留在这台设备上。'),
    }))
    throw error
  }
  const latest = pendingSessions.get(id)
  if (!latest) return
  try {
    const saved = await saveSession(latest)
    const current = pendingSessions.get(id)
    if (!current || current.updated_at !== pushedAt) return
    pendingSessions.delete(id)
    sessionPins.set(saved.id, { item: saved, at: Date.now() })
    await writePendingBundle(bundle())
    if (!pendingSessions.has(saved.id)) replaceSession(saved)
    update((current) => ({
      ...current,
      syncNotice: hasPending() ? current.syncNotice : null,
    }))
  } catch (error) {
    if (pendingSessions.get(id)?.updated_at !== pushedAt) return
    update((current) => ({
      ...current,
      offline: isOffline(error) || current.offline,
      syncNotice: errorText(error, '对话没能同步到云端，仍留在这台设备上。'),
    }))
    throw error
  }
}

function syncSession(id: string): Promise<void> {
  return enqueueChain(sessionChains, id, () => pushSessionBody(id))
}

function replaceMessage(message: ChatMessage) {
  update((current) => {
    const list = current.messages[message.session_id] ?? []
    const next = sortMessages([...list.filter((item) => item.id !== message.id), message])
    return {
      ...current,
      messages: { ...current.messages, [message.session_id]: next },
      messagesStatus: { ...current.messagesStatus, [message.session_id]: 'ready' },
    }
  })
}

function stageMessage(message: ChatMessage) {
  pendingMessages.set(message.id, message)
  replaceMessage(message)
  void putMessageLocal(message).catch(() => undefined)
  void writePendingBundle(bundle()).catch(() => undefined)
}

async function pushMessageBody(id: string) {
  await accountKnown
  const message = pendingMessages.get(id)
  if (!message) return
  const pushedAt = message.created_at
  try {
    await syncSession(message.session_id)
  } catch (error) {
    if (pendingMessages.get(id)?.created_at !== pushedAt) return
    update((current) => ({
      ...current,
      syncNotice: current.syncNotice || errorText(error, '这条消息没能同步到云端，仍留在这台设备上。'),
    }))
    throw error
  }
  const latest = pendingMessages.get(id)
  if (!latest) return
  try {
    const saved = await saveMessage(latest)
    if (pendingMessages.get(id)?.created_at !== pushedAt) return
    pendingMessages.delete(id)
    messagePins.set(saved.id, { item: saved, at: Date.now() })
    await writePendingBundle(bundle())
    if (!pendingMessages.has(saved.id)) replaceMessage(saved)
    update((current) => ({
      ...current,
      offline: false,
      syncNotice: hasPending() ? current.syncNotice : null,
    }))
  } catch (error) {
    if (pendingMessages.get(id)?.created_at !== pushedAt) return
    update((current) => ({
      ...current,
      offline: isOffline(error) || current.offline,
      syncNotice: errorText(error, '这条消息没能同步到云端，仍留在这台设备上。'),
    }))
    throw error
  }
}

function syncMessage(id: string): Promise<void> {
  return enqueueChain(messageChains, id, () => pushMessageBody(id))
}

async function flushPending() {
  for (const id of [...pendingProfiles.keys()]) {
    try {
      await syncProfile(id)
    } catch {
      return
    }
  }
  for (const id of [...pendingSessions.keys()]) {
    try {
      await syncSession(id)
    } catch {
      return
    }
  }
  for (const id of [...pendingMessages.keys()]) {
    try {
      await syncMessage(id)
    } catch {
      return
    }
  }
}

export function stopStream() {
  abortController?.abort()
}

export async function sendChat(profile: Profile): Promise<void> {
  if (snapshot.stream?.busy) return
  const content = (snapshot.chat.draftByProfile[profile.id] ?? '').trim()
  if (!content) return
  const generation = ++streamGeneration
  const timestamp = nowIso()
  let sessionId = snapshot.chat.sessionByProfile[profile.id] ?? null
  let session =
    (sessionId ? (snapshot.sessions[profile.id] ?? []).find((item) => item.id === sessionId) : null) ??
    (sessionId ? (pendingSessions.get(sessionId) ?? null) : null)
  if (!session) {
    session = {
      id: createId(),
      profile_id: profile.id,
      title: content.slice(0, 18),
      created_at: timestamp,
      updated_at: timestamp,
    }
    sessionId = session.id
    stageSession(session)
  }
  const activeSession = session
  const userMessage: ChatMessage = {
    id: createId(),
    session_id: activeSession.id,
    role: 'user',
    content,
    created_at: timestamp,
  }
  stageMessage(userMessage)
  void syncSession(activeSession.id).catch(() => undefined)
  void syncMessage(userMessage.id).catch(() => undefined)
  update((current) => ({
    ...current,
    chat: {
      ...current.chat,
      profileId: profile.id,
      error: '',
      draftByProfile: { ...current.chat.draftByProfile, [profile.id]: '' },
      sessionByProfile: { ...current.chat.sessionByProfile, [profile.id]: activeSession.id },
    },
    stream: {
      profileId: profile.id,
      sessionId: activeSession.id,
      content: '',
      reasoning: '',
      busy: true,
    },
  }))
  const history = snapshot.messages[activeSession.id] ?? [userMessage]
  const controller = new AbortController()
  abortController = controller
  const model = snapshot.settings?.model === 'deepseek-reasoner' ? 'deepseek-reasoner' : 'deepseek-chat'
  try {
    const chart = computeChart(profile)
    const reply = await streamChat({
      model,
      signal: controller.signal,
      onDelta: (next) => {
        if (generation !== streamGeneration) return
        update((current) => {
          if (!current.stream || current.stream.sessionId !== activeSession.id) return current
          return {
            ...current,
            stream: { ...current.stream, content: next.content, reasoning: next.reasoning },
          }
        })
      },
      messages: [
        { role: 'system', content: buildSystemPrompt(profile, chart) },
        ...history.slice(-40).map((message) => ({ role: message.role, content: message.content })),
      ],
    })
    if (generation !== streamGeneration) return
    const text = reply.content.trim()
    const thought = reply.reasoning.trim()
    if (!text) {
      update((current) => ({
        ...current,
        chat: { ...current.chat, error: '这次没有生成内容，可以换种说法再试。' },
        stream: current.stream ? { ...current.stream, busy: false } : null,
      }))
      return
    }
    const assistant: ChatMessage = {
      id: createId(),
      session_id: activeSession.id,
      role: 'assistant',
      content: text,
      ...(thought ? { reasoning: thought } : {}),
      created_at: nowIso(),
    }
    const touched: ChatSession = {
      ...activeSession,
      updated_at: assistant.created_at,
      title: activeSession.title || content.slice(0, 18),
    }
    stageMessage(assistant)
    stageSession(touched)
    void syncMessage(assistant.id).catch(() => undefined)
    void syncSession(touched.id).catch(() => undefined)
    update((current) => ({
      ...current,
      stream: current.stream?.sessionId === activeSession.id ? null : current.stream,
    }))
  } catch (error) {
    if (generation !== streamGeneration) return
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    update((current) => ({
      ...current,
      chat: {
        ...current.chat,
        error: aborted ? '已停下来。' : errorText(error, '聊天没有完成。'),
      },
      stream:
        current.stream?.sessionId === activeSession.id ? { ...current.stream, busy: false } : current.stream,
    }))
  } finally {
    if (abortController === controller) abortController = null
  }
}

export async function saveModelOptimistic(model: LlmModel): Promise<void> {
  const previous = snapshot.settings
  const next: AppSettings = previous
    ? { ...previous, model, offline: false }
    : { email: null, model, lastProfileId: null, offline: false }
  update((current) => ({ ...current, settings: next, settingsStatus: 'ready' }))
  await persistSettings(next)
  try {
    await saveModel(model)
    update((current) => ({
      ...current,
      settings: current.settings ? { ...current.settings, model, offline: false } : next,
      offline: false,
    }))
  } catch (error) {
    if (previous) {
      update((current) => ({ ...current, settings: previous }))
      await persistSettings(previous)
    }
    throw error
  }
}
