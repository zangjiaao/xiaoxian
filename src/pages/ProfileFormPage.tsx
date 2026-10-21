import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ProfileForm, type ProfileDraft } from '../components/ProfileForm.tsx'
import { createId, nowIso } from '../lib/id.ts'
import { ensureProfile, rememberLastProfile, stageProfile, syncProfile, useMemorySelector, warmCache } from '../lib/memory.ts'
import { styles } from '../styles.ts'
import type { Profile } from '../types.ts'

export function ProfileFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const booted = useMemorySelector((state) => state.booted)
  const profiles = useMemorySelector((state) => state.profiles)
  const status = useMemorySelector((state) => state.profilesStatus)
  const miss = useMemorySelector((state) => (id ? state.profileMiss[id] === true : false))
  const loadError = useMemorySelector((state) => state.profilesError)
  const profile = id ? (profiles?.find((item) => item.id === id) ?? null) : null

  useEffect(() => {
    document.title = `${isEdit ? '编辑档案' : '新建档案'} · 小闲`
  }, [isEdit])

  useEffect(() => {
    void warmCache()
    if (id) ensureProfile(id)
  }, [id])

  async function save(draft: ProfileDraft) {
    const timestamp = nowIso()
    const next: Profile = {
      id: profile?.id ?? createId(),
      ...draft,
      created_at: profile?.created_at ?? timestamp,
      updated_at: timestamp,
    }
    await stageProfile(next)
    rememberLastProfile(next.id)
    void syncProfile(next.id).catch(() => undefined)
    navigate(`/chart/${next.id}`)
  }

  if (id && !profile && miss) {
    return (
      <VStack gap={3}>
        <Heading level={2} xstyle={styles.pageTitle}>
          没有找到这份档案
        </Heading>
        <Button label="回到档案" variant="primary" onClick={() => navigate('/')} />
      </VStack>
    )
  }

  if (id && !profile && loadError && status !== 'loading') {
    return (
      <VStack gap={3}>
        <Heading level={2} xstyle={styles.pageTitle}>
          档案暂时打不开
        </Heading>
        <Text type="supporting">{loadError}</Text>
        <Button label="回到档案" variant="primary" onClick={() => navigate('/')} />
      </VStack>
    )
  }

  if (id && !profile && !booted) return null
  if (id && !profile) return <Text type="supporting">正在读取档案…</Text>

  return (
    <VStack gap={4}>
      <Heading level={2} xstyle={styles.pageTitle}>
        {isEdit ? '编辑档案' : '新建档案'}
      </Heading>
      <Text type="supporting" xstyle={styles.pageLead}>
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
