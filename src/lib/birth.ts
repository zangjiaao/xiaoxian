import type { Gender, Profile } from '../types.ts'

export function genderLabel(gender: Gender): string {
  return gender === 'male' ? '男' : '女'
}

export function formatBirth(
  profile: Pick<Profile, 'birth_year' | 'birth_month' | 'birth_day' | 'birth_hour' | 'birth_minute'>,
): string {
  const date = `${profile.birth_year}年${profile.birth_month}月${profile.birth_day}日`
  if (profile.birth_hour == null) return `${date} · 时辰未知`
  const hour = String(profile.birth_hour).padStart(2, '0')
  const minute = String(profile.birth_minute ?? 0).padStart(2, '0')
  return `${date} ${hour}:${minute}`
}

export function isValidCivilDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}
