import Dexie, { type Table } from 'dexie'
import type { ChartCache, ChatMessage, ChatSession, Profile } from './types.ts'

export class XiaoXianDB extends Dexie {
  profiles!: Table<Profile, string>
  charts!: Table<ChartCache, string>
  chat_sessions!: Table<ChatSession, string>
  chat_messages!: Table<ChatMessage, string>
  settings!: Table<{ key: string; value_json: string }, string>

  constructor() {
    super('xiaoxian')
    this.version(1).stores({
      profiles: 'id, display_name, updated_at',
      charts: 'id, profile_id, computed_at',
      chat_sessions: 'id, profile_id, updated_at',
      chat_messages: 'id, session_id, created_at',
      settings: 'key',
    })
  }
}

export const db = new XiaoXianDB()

export async function deleteProfile(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.profiles,
    db.charts,
    db.chat_sessions,
    db.chat_messages,
    async () => {
      const sessions = await db.chat_sessions.where('profile_id').equals(id).toArray()
      const sessionIds = sessions.map((session) => session.id)
      if (sessionIds.length > 0) {
        await db.chat_messages.where('session_id').anyOf(sessionIds).delete()
      }
      await db.chat_sessions.where('profile_id').equals(id).delete()
      await db.charts.where('profile_id').equals(id).delete()
      await db.profiles.delete(id)
    },
  )
}
