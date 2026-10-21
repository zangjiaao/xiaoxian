import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState } from 'react'
import { LegacyImport } from '../components/LegacyImport.tsx'
import { DEFAULT_MODEL, isLlmModel, type LlmModel } from '../lib/models.ts'
import { DEFAULT_LLM, getLlmSettings, loadAppSettings, saveLlmSettings } from '../lib/settings.ts'

export function SettingsPage() {
  const [model, setModel] = useState<LlmModel>(DEFAULT_MODEL)
  const [email, setEmail] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = '设置 · 小闲'
    void Promise.all([getLlmSettings(), loadAppSettings()])
      .then(([stored, app]) => {
        setModel(isLlmModel(stored.model) ? stored.model : DEFAULT_MODEL)
        setEmail(app.email)
        setOffline(app.offline)
        setStatus('ready')
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : '设置暂时打不开。')
        setStatus('ready')
      })
  }, [])

  async function save(next = model) {
    setError('')
    try {
      await saveLlmSettings({ ...DEFAULT_LLM, model: next })
      setModel(next)
      setNotice(next === 'deepseek-reasoner' ? '已换成 deepseek-reasoner。回复前会多一段思考过程。' : '已换成 deepseek-chat。')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '没有保存成功。')
    }
  }

  if (status === 'loading') return <Text type="supporting">正在读取设置…</Text>

  return (
    <VStack gap={4}>
      <Heading level={2}>设置</Heading>
      <LegacyImport includeDismissed />
      <Banner
        status="info"
        title="密钥不在浏览器里"
        description="DeepSeek 密钥放在 Cloudflare Worker 的 secret 里，页面不再保存，也不会发出去。这里只选择用哪个模型。"
        collapsible={false}
      />
      {email ? <Text type="supporting">当前账号 {email}</Text> : null}
      {offline ? <Text type="supporting">云端暂时连不上，显示的是这台设备上的缓存。</Text> : null}
      <Text>模型</Text>
      <HStack gap={2} wrap="wrap">
        <Button
          label="deepseek-chat"
          variant={model === 'deepseek-chat' ? 'primary' : 'secondary'}
          onClick={() => void save('deepseek-chat')}
        />
        <Button
          label="deepseek-reasoner"
          variant={model === 'deepseek-reasoner' ? 'primary' : 'secondary'}
          onClick={() => void save('deepseek-reasoner')}
        />
      </HStack>
      <Text type="supporting">
        deepseek-chat 更快。deepseek-reasoner 在回复前会多一块可折叠的「思考过程」。
      </Text>
      {notice ? <Text>{notice}</Text> : null}
      {error ? <Text>{error}</Text> : null}
      <Text type="supporting">排盘不调用模型。只有「聊聊」会把机器排盘和你的话发给云端，再由云端转给 DeepSeek。</Text>
    </VStack>
  )
}
