export type Gender = 'male' | 'female'

export interface Profile {
  id: string
  display_name: string
  gender: Gender
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

export interface ChartCache {
  id: string
  profile_id: string
  computed_at: string
  clock_mode: 'civil'
  payload_json: string
}

export interface ChatSession {
  id: string
  profile_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  created_at: string
}

export interface LlmSettings {
  apiKey: string
  baseURL: string
  model: string
}

export interface Pillar {
  label: string
  ganZhi: string
  gan: string
  zhi: string
  wuXing: string
  naYin: string
  shiShenGan: string
  hidden: string[]
  known: boolean
}

export interface DaYunItem {
  index: number
  ganZhi: string
  label: string
  startAge: number
  endAge: number
  startYear: number
  endYear: number
  isCurrent: boolean
  isPreYun: boolean
}

export interface ChartPayload {
  clockMode: 'civil'
  hourKnown: boolean
  pillars: Pillar[]
  dayMaster: string
  dayMasterElement: string
  dayMasterNote: string
  tenGodsBrief: string
  daYun: DaYunItem[]
  currentDaYun: DaYunItem | null
  yunDirection: '顺行' | '逆行'
  yunStartText: string
  liuNian: {
    year: number
    ganZhi: string
    gregorianYear: number
    beforeLiChun: boolean
  }
  lunarText: string
  warnings: string[]
}
