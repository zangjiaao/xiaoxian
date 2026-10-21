import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState } from 'react'
import { dismissLegacy, importLegacy, peekLegacy, type LegacyPreview } from '../lib/store.ts'

export function LegacyImport({
  includeDismissed = false,
  onImported,
}: {
  includeDismissed?: boolean
  onImported?: () => void
}) {
  const [preview, setPreview] = useState<LegacyPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    let cancelled = false
    void peekLegacy(includeDismissed).then((next) => {
      if (!cancelled) setPreview(next)
    })
    return () => {
      cancelled = true
    }
  }, [includeDismissed])

  async function run() {
    setBusy(true)
    setError('')
    try {
      const result = await importLegacy()
      setPreview(null)
      const skipped = result.skipped > 0 ? `有 ${result.skipped} 条没能导入。` : ''
      setDone(`已导入 ${result.profiles} 份档案、${result.chat_messages} 条消息。${skipped}`)
      onImported?.()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入没有完成。')
    } finally {
      setBusy(false)
    }
  }

  if (done) return <Text>{done}</Text>
  if (!preview && !error) return null
  if (!preview) return <Text>{error}</Text>

  return (
    <VStack gap={2}>
      <Banner
        status="info"
        title="这台设备上还有本地档案"
        description={`有 ${preview.profiles} 份档案、${preview.messages} 条聊天。可以一次性导入到当前登录邮箱的云端。以前写在浏览器里的 API Key 不会上传。`}
        collapsible={false}
        endContent={
          <HStack gap={2} wrap="wrap">
            <Button
              label={busy ? '导入中' : '导入到云端'}
              variant="primary"
              size="sm"
              onClick={() => void run()}
              isDisabled={busy}
            />
            {includeDismissed ? null : (
              <Button
                label="先不导入"
                variant="ghost"
                size="sm"
                isDisabled={busy}
                onClick={() => {
                  void dismissLegacy().then(() => setPreview(null))
                }}
              />
            )}
          </HStack>
        }
      />
      {error ? <Text>{error}</Text> : null}
    </VStack>
  )
}
