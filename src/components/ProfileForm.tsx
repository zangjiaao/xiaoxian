import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { isValidCivilDate, parseOptionalInt } from '../lib/birth.ts'
import { styles } from '../styles.ts'
import type { Gender, Profile } from '../types.ts'

export interface ProfileDraft {
  display_name: string
  gender: Gender
  birth_year: number
  birth_month: number
  birth_day: number
  birth_hour: number | null
  birth_minute: number | null
  birth_place: string
  notes: string
}

interface FieldErrors {
  display_name?: string
  gender?: string
  birth_year?: string
  birth_month?: string
  birth_day?: string
  birth_hour?: string
  birth_minute?: string
}

function status(message?: string) {
  return message ? { type: 'error' as const, message } : undefined
}

export function ProfileForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Profile
  submitLabel: string
  onSubmit: (draft: ProfileDraft) => Promise<void>
}) {
  const [name, setName] = useState(initial?.display_name ?? '')
  const [gender, setGender] = useState<Gender | ''>(initial?.gender ?? '')
  const [year, setYear] = useState(initial ? String(initial.birth_year) : '')
  const [month, setMonth] = useState(initial ? String(initial.birth_month) : '')
  const [day, setDay] = useState(initial ? String(initial.birth_day) : '')
  const [hour, setHour] = useState(initial?.birth_hour == null ? '' : String(initial.birth_hour))
  const [minute, setMinute] = useState(
    initial?.birth_minute == null ? '' : String(initial.birth_minute),
  )
  const [place, setPlace] = useState(initial?.birth_place ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    const nextErrors: FieldErrors = {}
    const displayName = name.trim()
    if (!displayName) nextErrors.display_name = '写一个称呼，自己或朋友的名字都行。'
    if (displayName.length > 40) nextErrors.display_name = '称呼请控制在 40 字以内。'
    if (gender !== 'male' && gender !== 'female') {
      nextErrors.gender = '选一下性别。大运顺逆会用到，不会上传。'
    }

    const birthYear = parseOptionalInt(year)
    const birthMonth = parseOptionalInt(month)
    const birthDay = parseOptionalInt(day)
    const birthHour = parseOptionalInt(hour)
    const birthMinute = parseOptionalInt(minute)

    if (birthYear == null || Number.isNaN(birthYear) || birthYear < 1900 || birthYear > 2100) {
      nextErrors.birth_year = '年份用公历，1900 到 2100。'
    }
    if (birthMonth == null || Number.isNaN(birthMonth) || birthMonth < 1 || birthMonth > 12) {
      nextErrors.birth_month = '月份是 1 到 12。'
    }
    if (birthDay == null || Number.isNaN(birthDay) || birthDay < 1 || birthDay > 31) {
      nextErrors.birth_day = '日期是 1 到 31。'
    }
    if (
      !nextErrors.birth_year &&
      !nextErrors.birth_month &&
      !nextErrors.birth_day &&
      birthYear != null &&
      birthMonth != null &&
      birthDay != null &&
      !isValidCivilDate(birthYear, birthMonth, birthDay)
    ) {
      nextErrors.birth_day = '这一天在公历里不存在。'
    }
    if (birthHour != null && (Number.isNaN(birthHour) || birthHour > 23)) {
      nextErrors.birth_hour = '小时是 0 到 23，也可以留空。'
    }
    if (Number.isNaN(birthMinute) || (birthMinute != null && birthMinute > 59)) {
      nextErrors.birth_minute = '分钟是 0 到 59，也可以留空。'
    }
    if (birthHour == null && birthMinute != null) {
      nextErrors.birth_hour = '填了分钟的话，小时也要填。不想精确到时辰就两个都空着。'
    }
    if (place.trim().length > 80) {
      setFormError('出生地请控制在 80 字以内。')
    } else if (notes.trim().length > 500) {
      setFormError('备注请控制在 500 字以内。')
    } else {
      setFormError('')
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || place.trim().length > 80 || notes.trim().length > 500) {
      return
    }
    if (gender !== 'male' && gender !== 'female') return
    if (birthYear == null || birthMonth == null || birthDay == null) return

    setSaving(true)
    try {
      await onSubmit({
        display_name: displayName,
        gender,
        birth_year: birthYear,
        birth_month: birthMonth,
        birth_day: birthDay,
        birth_hour: birthHour,
        birth_minute: birthHour == null ? null : (birthMinute ?? 0),
        birth_place: place.trim(),
        notes: notes.trim(),
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '没有保存成功。')
      setSaving(false)
    }
  }

  return (
    <VStack gap={4}>
      <TextInput
        label="称呼"
        value={name}
        onChange={setName}
        placeholder="比如：我、阿树"
        isRequired
        status={status(errors.display_name)}
        autoComplete="nickname"
      />
      <RadioList
        label="性别"
        description="只用来判断大运顺逆，存在这台设备上。"
        value={gender}
        onChange={(value) => {
          if (value === 'male' || value === 'female') setGender(value)
        }}
        orientation="horizontal"
        isRequired
        status={status(errors.gender)}
      >
        <RadioListItem label="男" value="male" />
        <RadioListItem label="女" value="female" />
      </RadioList>
      <div {...stylex.props(styles.birthGrid)}>
        <TextInput
          label="公历年"
          value={year}
          onChange={setYear}
          placeholder="1990"
          isRequired
          status={status(errors.birth_year)}
        />
        <TextInput
          label="月"
          value={month}
          onChange={setMonth}
          placeholder="3"
          isRequired
          status={status(errors.birth_month)}
        />
        <TextInput
          label="日"
          value={day}
          onChange={setDay}
          placeholder="4"
          isRequired
          status={status(errors.birth_day)}
        />
        <TextInput
          label="时"
          description="留空则时柱未知"
          value={hour}
          onChange={setHour}
          placeholder="14"
          isOptional
          status={status(errors.birth_hour)}
        />
        <TextInput
          label="分"
          value={minute}
          onChange={setMinute}
          placeholder="30"
          isOptional
          status={status(errors.birth_minute)}
        />
      </div>
      <TextInput
        label="出生地"
        value={place}
        onChange={setPlace}
        placeholder="城市即可，暂时不参与计算"
        isOptional
      />
      <TextArea
        label="备注"
        value={notes}
        onChange={setNotes}
        placeholder="想让聊天记得的事，比如职业、最近在忙什么"
        rows={4}
        isOptional
      />
      {formError ? (
        <Banner status="error" title="还没保存" description={formError} collapsible={false} />
      ) : null}
      <Button label={saving ? '保存中' : submitLabel} variant="primary" onClick={() => void handleSubmit()} isDisabled={saving} />
    </VStack>
  )
}
