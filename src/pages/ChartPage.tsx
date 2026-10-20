import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db.ts'
import { formatBirth, genderLabel } from '../lib/birth.ts'
import { computeChart, currentDaYunLine, liuNianLine } from '../lib/chart.ts'
import { nowIso } from '../lib/id.ts'
import { getLastProfileId, setLastProfileId } from '../lib/settings.ts'
import { styles } from '../styles.ts'
import type { ChartPayload, Profile } from '../types.ts'

export function ChartPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [chart, setChart] = useState<ChartPayload | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    document.title = '排盘 · 小闲'
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setStatus('loading')
      try {
        const rows = await db.profiles.toArray()
        rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
        if (cancelled) return
        setProfiles(rows)
        let targetId = id
        if (!targetId) {
          const last = await getLastProfileId()
          targetId = rows.find((row) => row.id === last)?.id ?? rows[0]?.id
          if (targetId) {
            navigate(`/chart/${targetId}`, { replace: true })
            return
          }
        }
        const found = rows.find((row) => row.id === targetId) ?? null
        if (!found) {
          setProfile(null)
          setChart(null)
          setStatus(rows.length === 0 ? 'ready' : 'missing')
          return
        }
        const nextChart = computeChart(found)
        setProfile(found)
        setChart(nextChart)
        setStatus('ready')
        await setLastProfileId(found.id)
        await db.charts.put({
          id: found.id,
          profile_id: found.id,
          computed_at: nowIso(),
          clock_mode: 'civil',
          payload_json: JSON.stringify(nextChart),
        })
      } catch (error) {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : '排盘没有算出来。')
        setStatus('error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, navigate])

  if (status === 'loading') return <Text type="supporting">正在本地排盘…</Text>

  if (status === 'error') {
    return <EmptyState title="这次没排出来" description={message} />
  }

  if (profiles.length === 0) {
    return (
      <EmptyState
        title="还没有可以排的档案"
        description="排盘完全在浏览器里计算，不需要网络。"
        actions={<Button label="新建档案" variant="primary" onClick={() => navigate('/profiles/new')} />}
      />
    )
  }

  if (!profile || !chart || status === 'missing') {
    return (
      <EmptyState
        title="没有这份档案"
        description="它可能已经从这台设备上删掉了。"
        actions={<Button label="回到档案" variant="primary" onClick={() => navigate('/')} />}
      />
    )
  }

  return (
    <VStack gap={4}>
      <HStack gap={3} align="center" justify="between" wrap="wrap">
        <Heading level={2}>{profile.display_name}的四柱</Heading>
        <Button label="拿去聊聊" variant="primary" onClick={() => navigate(`/chat/${profile.id}`)} />
      </HStack>
      <Selector
        label="切换档案"
        options={profiles.map((item) => ({
          value: item.id,
          label: item.display_name,
          description: formatBirth(item),
        }))}
        value={profile.id}
        onChange={(value) => {
          if (value) navigate(`/chart/${value}`)
        }}
      />
      <Banner
        status="info"
        title="这是对照，不是判决"
        description="干支可以当性格和节奏的比喻。健康、法律和重大财务决定，请找对应的专业人士。"
        collapsible={false}
      />
      <Text type="supporting">
        {genderLabel(profile.gender)} · {formatBirth(profile)}
        {profile.birth_place ? ` · ${profile.birth_place}` : ''} · 农历 {chart.lunarText}
      </Text>
      <div {...stylex.props(styles.pillars)}>
        {chart.pillars.map((pillar) => (
          <Card key={pillar.label} padding={3} variant={pillar.label === '日柱' ? 'teal' : 'default'}>
            <VStack gap={1}>
              <Text type="supporting">{pillar.label}</Text>
              <Heading level={3}>{pillar.known ? pillar.ganZhi : '未知'}</Heading>
              {pillar.known ? (
                <>
                  <Text>{pillar.shiShenGan}</Text>
                  <Text type="supporting">纳音 {pillar.naYin}</Text>
                  <Text type="supporting">藏干 {pillar.hidden.join('、')}</Text>
                </>
              ) : (
                <Text type="supporting">六字盘，时柱先空着。</Text>
              )}
            </VStack>
          </Card>
        ))}
      </div>
      <Card padding={4}>
        <VStack gap={2}>
          <Heading level={3}>
            日主 {chart.dayMaster}
            {chart.dayMasterElement}
          </Heading>
          <Text>{chart.dayMasterNote}</Text>
          <Text type="supporting">{chart.tenGodsBrief}</Text>
        </VStack>
      </Card>
      <VStack gap={2}>
        <Heading level={3}>大运</Heading>
        <Text type="supporting">
          {chart.yunStartText}。当前：{currentDaYunLine(chart)}。
        </Text>
        <div {...stylex.props(styles.timeline)}>
          {chart.daYun.map((item) => (
            <Card
              key={`${item.index}-${item.label}`}
              padding={3}
              variant={item.isCurrent ? 'green' : 'muted'}
              xstyle={styles.yunCard}
            >
              <VStack gap={1}>
                <Text weight="semibold">{item.label}</Text>
                <Text type="supporting">
                  {item.startAge}–{item.endAge} 岁
                </Text>
                <Text type="supporting">
                  {item.startYear}–{item.endYear}
                </Text>
                {item.isCurrent ? <Text>当前这段</Text> : null}
              </VStack>
            </Card>
          ))}
        </div>
      </VStack>
      <Card padding={4} variant="muted">
        <VStack gap={1}>
          <Heading level={3}>今年流年</Heading>
          <Text>{liuNianLine(chart)}</Text>
          <Text type="supporting">流年按立春交节切换，不一定跟元旦同一天。</Text>
        </VStack>
      </Card>
      <Card padding={4} variant="muted">
        <VStack gap={2}>
          <Heading level={3}>怎么读这张盘</Heading>
          {chart.warnings.map((warning) => (
            <Text key={warning}>{warning}</Text>
          ))}
        </VStack>
      </Card>
      {profile.notes ? (
        <Card padding={4}>
          <VStack gap={1}>
            <Heading level={3}>档案备注</Heading>
            <Text {...stylex.props(styles.prose)}>{profile.notes}</Text>
          </VStack>
        </Card>
      ) : null}
      <Text type="supporting">命盘会缓存在这台设备上，下次打开仍按当天重算流年。</Text>
    </VStack>
  )
}
