import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LegacyImport } from '../components/LegacyImport.tsx'
import { formatBirth, genderLabel } from '../lib/birth.ts'
import { setLastProfileId } from '../lib/settings.ts'
import { listProfiles, removeProfile } from '../lib/store.ts'
import { styles } from '../styles.ts'
import type { Profile } from '../types.ts'

export function ProfilesPage() {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null)
  const [offline, setOffline] = useState(false)

  async function load() {
    try {
      const result = await listProfiles()
      setProfiles(result.profiles)
      setOffline(result.offline)
      setStatus('ready')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '档案打不开。')
      setStatus('error')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    document.title = '档案 · 小闲'
  }, [])

  if (status === 'loading') {
    return <Text type="supporting">正在打开档案…</Text>
  }

  if (status === 'error') {
    return (
      <EmptyState
        title="档案暂时打不开"
        description={message || '云端暂时没有回应。'}
        actions={<Button label="再试一次" variant="primary" onClick={() => void load()} />}
      />
    )
  }

  return (
    <VStack gap={4}>
      <HStack gap={3} align="center" justify="between">
        <Heading level={2} xstyle={styles.pageTitle}>
          档案
        </Heading>
        <Button label="新建档案" variant="primary" onClick={() => navigate('/profiles/new')} />
      </HStack>
      <LegacyImport onImported={() => void load()} />
      {offline ? (
        <Banner
          status="warning"
          title="正在看这台设备上的缓存"
          description="云端暂时连不上。排盘仍可以看，改档案和聊天要等网络回来。"
          collapsible={false}
        />
      ) : null}
      <Text type="supporting" xstyle={styles.pageLead}>
        档案按登录邮箱分开存在云端。时辰可以先空着，排盘会标成六字。
      </Text>
      {profiles.length === 0 ? (
        <EmptyState
          title="还没有档案"
          description="先记下一个公历生日，就可以看四柱，也可以拿它当聊天的背景。"
          actions={
            <Button label="记下第一个" variant="primary" onClick={() => navigate('/profiles/new')} />
          }
        />
      ) : (
        profiles.map((profile) => (
          <Card key={profile.id} padding={4}>
            <VStack gap={2}>
              <HStack gap={2} align="center">
                <Heading level={3}>{profile.display_name}</Heading>
                <Text type="supporting">{genderLabel(profile.gender)}</Text>
              </HStack>
              <Text>{formatBirth(profile)}</Text>
              {profile.birth_place ? <Text type="supporting">{profile.birth_place}</Text> : null}
              <HStack gap={2} wrap="wrap">
                <Button
                  label="排盘"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    void setLastProfileId(profile.id)
                    navigate(`/chart/${profile.id}`)
                  }}
                />
                <Button
                  label="聊聊"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void setLastProfileId(profile.id)
                    navigate(`/chat/${profile.id}`)
                  }}
                />
                <Button
                  label="编辑"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/profiles/${profile.id}/edit`)}
                />
                <Button
                  label="删除"
                  variant="destructive"
                  size="sm"
                  onClick={() => setPendingDelete(profile)}
                />
              </HStack>
            </VStack>
          </Card>
        ))
      )}
      <AlertDialog
        isOpen={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={pendingDelete ? `删除「${pendingDelete.display_name}」？` : '删除档案？'}
        description="云端的排盘缓存和聊天记录会一起去掉。"
        actionLabel="删除"
        cancelLabel="留下"
        onAction={() => {
          if (!pendingDelete) return
          void removeProfile(pendingDelete.id).then(() => {
            setPendingDelete(null)
            return load()
          })
        }}
      />
    </VStack>
  )
}
