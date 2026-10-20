import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ProfileForm, type ProfileDraft } from '../components/ProfileForm.tsx'
import { db } from '../db.ts'
import { createId, nowIso } from '../lib/id.ts'
import { setLastProfileId } from '../lib/settings.ts'
import type { Profile } from '../types.ts'

export function ProfileFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>(id ? 'loading' : 'ready')

  useEffect(() => {
    document.title = `${isEdit ? '编辑档案' : '新建档案'} · 小闲`
  }, [isEdit])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void db.profiles.get(id).then((row) => {
      if (cancelled) return
      if (!row) {
        setStatus('missing')
        return
      }
      setProfile(row)
      setStatus('ready')
    })
    return () => {
      cancelled = true
    }
  }, [id])

  async function save(draft: ProfileDraft) {
    const timestamp = nowIso()
    const next: Profile = {
      id: profile?.id ?? createId(),
      ...draft,
      created_at: profile?.created_at ?? timestamp,
      updated_at: timestamp,
    }
    await db.profiles.put(next)
    await setLastProfileId(next.id)
    navigate(`/chart/${next.id}`)
  }

  if (status === 'loading') return <Text type="supporting">正在读取档案…</Text>
  if (status === 'missing') {
    return (
      <VStack gap={3}>
        <Heading level={2}>没有找到这份档案</Heading>
        <Button label="回到档案" variant="primary" onClick={() => navigate('/')} />
      </VStack>
    )
  }

  return (
    <VStack gap={4}>
      <Heading level={2}>{isEdit ? '编辑档案' : '新建档案'}</Heading>
      <Text type="supporting">
        时和分可以留空。空着就只排六字，并在命盘上标明时柱未知。
      </Text>
      <ProfileForm
        key={profile?.id ?? 'new'}
        initial={profile ?? undefined}
        submitLabel={isEdit ? '保存并查看命盘' : '保存并排盘'}
        onSubmit={save}
      />
      <Button label="取消" variant="ghost" onClick={() => navigate(profile ? `/chart/${profile.id}` : '/')} />
    </VStack>
  )
}
