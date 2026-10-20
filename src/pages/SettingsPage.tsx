import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState } from 'react'
import { DEFAULT_LLM, getLlmSettings, saveLlmSettings } from '../lib/settings.ts'
import type { LlmSettings } from '../types.ts'

export function SettingsPage() {
  const [settings, setSettings] = useState<LlmSettings>(DEFAULT_LLM)
  const [showKey, setShowKey] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    document.title = '设置 · 小闲'
    void getLlmSettings().then((stored) => {
      setSettings(stored)
      setStatus('ready')
    })
  }, [])

  async function save() {
    await saveLlmSettings(settings)
    setNotice(settings.apiKey.trim() ? '已保存在这台设备上。' : '密钥已清空。')
  }

  if (status === 'loading') return <Text type="supporting">正在读取本地设置…</Text>

  return (
    <VStack gap={4}>
      <Heading level={2}>设置</Heading>
      <Banner
        status="info"
        title="密钥不出这台设备"
        description="API Key 只写进浏览器的 IndexedDB，不会进仓库，也没有后端替你转发。换浏览器或清站点数据后需要再贴一次。"
        collapsible={false}
      />
      <TextInput
        label="DeepSeek API Key"
        type={showKey ? 'text' : 'password'}
        value={settings.apiKey}
        onChange={(value) => setSettings((current) => ({ ...current, apiKey: value }))}
        placeholder="sk-..."
        autoComplete="off"
        description="从 DeepSeek 开放平台复制。熟人共用这台设备时，对方也能读到它。"
      />
      <HStack gap={2} wrap="wrap">
        <Button
          label={showKey ? '隐藏密钥' : '显示密钥'}
          variant="ghost"
          onClick={() => setShowKey((current) => !current)}
        />
        <Button
          label="清除密钥"
          variant="destructive"
          onClick={() => {
            setSettings((current) => ({ ...current, apiKey: '' }))
            setNotice('输入框已清空，点保存后才会从本地删掉。')
          }}
        />
      </HStack>
      <TextInput
        label="接口地址"
        value={settings.baseURL}
        onChange={(value) => setSettings((current) => ({ ...current, baseURL: value }))}
        description="默认 https://api.deepseek.com ，兼容 OpenAI Chat Completions 的地址也可以。"
      />
      <TextInput
        label="模型"
        value={settings.model}
        onChange={(value) => setSettings((current) => ({ ...current, model: value }))}
        description="默认 deepseek-chat，回复更快。完整批盘若想看见推理，可改成 deepseek-reasoner，聊聊里会多一块可折叠的「思考过程」。模型名也可以手写。"
      />
      <HStack gap={2} wrap="wrap">
        <Button
          label="deepseek-chat"
          variant={settings.model.trim() === 'deepseek-chat' ? 'primary' : 'secondary'}
          onClick={() => setSettings((current) => ({ ...current, model: 'deepseek-chat' }))}
        />
        <Button
          label="deepseek-reasoner"
          variant={settings.model.trim() === 'deepseek-reasoner' ? 'primary' : 'secondary'}
          onClick={() => setSettings((current) => ({ ...current, model: 'deepseek-reasoner' }))}
        />
      </HStack>
      <HStack gap={2} wrap="wrap">
        <Button label="保存" variant="primary" onClick={() => void save()} />
        <Button
          label="恢复默认地址和模型"
          variant="secondary"
          onClick={() =>
            setSettings((current) => ({
              ...current,
              baseURL: DEFAULT_LLM.baseURL,
              model: DEFAULT_LLM.model,
            }))
          }
        />
      </HStack>
      {notice ? <Text>{notice}</Text> : null}
      <Text type="supporting">
        排盘不调用这个接口。只有「聊聊」会把机器排盘全文和你的话发给你填写的地址。
      </Text>
    </VStack>
  )
}
