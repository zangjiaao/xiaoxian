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
import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatBirth, genderLabel } from '../lib/birth.ts'
import { computeChart, currentDaYunLine, liuNianLine } from '../lib/chart.ts'
import { nowIso } from '../lib/id.ts'
import { dayKey, rememberChart, rememberLastProfile, useMemorySelector, warmCache } from '../lib/memory.ts'
import { saveChart } from '../lib/store.ts'
import { styles } from '../styles.ts'

export function ChartPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const booted = useMemorySelector((state) => state.booted)
  const profiles = useMemorySelector((state) => state.profiles)
  const status = useMemorySelector((state) => state.profilesStatus)
  const message = useMemorySelector((state) => state.profilesError) ?? ''
  const lastProfileId = useMemorySelector((state) => state.settings?.lastProfileId ?? null)
  const cachedChart = useMemorySelector((state) => (id ? state.charts[id] : undefined))
  const profile = profiles?.find((item) => item.id === id) ?? null
  const today = dayKey()
  const chart = useMemo(() => {
    if (!profile) return cachedChart?.payload ?? null
    if (cachedChart && cachedChart.updatedAt === profile.updated_at && cachedChart.day === today) {
      return cachedChart.payload
    }
    return computeChart(profile)
  }, [cachedChart, profile, today])

  useEffect(() => {
    document.title = '排盘 · 小闲'
    void warmCache()
  }, [])

  useEffect(() => {
    if (status !== 'ready' || !profiles) return
    if (id) return
    const target = profiles.find((item) => item.id === lastProfileId)?.id ?? profiles[0]?.id
    if (target) navigate(`/chart/${target}`, { replace: true })
  }, [id, lastProfileId, navigate, profiles, status])

  useEffect(() => {
    if (!profile || !chart) return
    rememberChart(profile, chart)
    rememberLastProfile(profile.id)
    void saveChart({
      id: profile.id,
      profile_id: profile.id,
      computed_at: nowIso(),
      clock_mode: 'civil',
      payload_json: JSON.stringify(chart),
    })
  }, [chart, profile])

  if (!booted && !profile && !profiles) return null

  if (status === 'error' && !profile) {
    return <EmptyState title="这次没排出来" description={message || '云端暂时没有回应。'} />
  }

  if ((status !== 'ready' || !profiles) && !profile) return <Text type="supporting">正在排盘…</Text>

  if (!profiles || profiles.length === 0) {
    return (
      <EmptyState
        title="还没有可以排的档案"
        description="排盘完全在浏览器里计算，不需要网络。"
        actions={<Button label="新建档案" variant="primary" onClick={() => navigate('/profiles/new')} />}
      />
    )
  }

  if (!id || !profile || !chart) {
    if (!id || status !== 'ready') return <Text type="supporting">正在排盘…</Text>
    return (
      <EmptyState
        title="没有这份档案"
        description="它可能已经从云端删掉了。"
        actions={<Button label="回到档案" variant="primary" onClick={() => navigate('/')} />}
      />
    )
  }

  return (
    <VStack gap={4}>
      <HStack gap={3} align="center" justify="between" wrap="wrap">
        <Heading level={2} xstyle={styles.pageTitle}>
          {profile.display_name}的四柱
        </Heading>
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
      <Text type="supporting" xstyle={styles.pageLead}>
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
      <Text type="supporting">排盘在这台设备上计算。档案存在云端，下次打开仍按当天重算流年。</Text>
    </VStack>
  )
}
