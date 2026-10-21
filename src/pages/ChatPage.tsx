import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MarkdownText } from '../components/MarkdownText.tsx'
import { formatBirth } from '../lib/birth.ts'
import { computeChart } from '../lib/chart.ts'
import { createId, nowIso } from '../lib/id.ts'
import { streamChat } from '../lib/llm.ts'
import { buildSystemPrompt } from '../lib/prompt.ts'
import { getLastProfileId, getLlmSettings, setLastProfileId } from '../lib/settings.ts'
import { listMessages, listProfiles, listSessions, saveMessage, saveSession } from '../lib/store.ts'
import { styles } from '../styles.ts'
import type { ChatMessage, ChatSession, Profile } from '../types.ts'

export function ChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    document.title = '聊聊 · 小闲'
  }, [])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
  }, [messages, streaming, streamingReasoning, busy, sessionId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setStatus('loading')
      const loaded = await listProfiles()
      const rows = loaded.profiles
      if (cancelled) return
      setProfiles(rows)
      setOffline(loaded.offline)
      let targetId = id
      if (!targetId) {
        const last = await getLastProfileId()
        targetId = rows.find((row) => row.id === last)?.id ?? rows[0]?.id
        if (targetId) {
          navigate(`/chat/${targetId}`, { replace: true })
          return
        }
      }
      const found = rows.find((row) => row.id === targetId) ?? null
      if (!found) {
        setProfile(null)
        setStatus(rows.length === 0 ? 'ready' : 'missing')
        return
      }
      const nextSessions = await listSessions(found.id)
      if (cancelled) return
      setProfile(found)
      setSessions(nextSessions)
      setSessionId(nextSessions[0]?.id ?? null)
      if (nextSessions.length === 0) setMessages([])
      setStatus('ready')
      await setLastProfileId(found.id)
    }
    void load().catch((loadError: unknown) => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : '对话页打不开。')
        setStatus('ready')
      }
    })
    return () => {
      cancelled = true
    }
  }, [id, navigate])

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void listMessages(sessionId).then((rows) => {
      if (cancelled) return
      setMessages(rows)
    })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  async function send() {
    if (!profile || busy) return
    const content = draft.trim()
    if (!content) return
    setError('')
    setBusy(true)
    setStreaming('')
    setStreamingReasoning('')
    const settings = await getLlmSettings()

    const timestamp = nowIso()
    let activeSession = sessionId
    let activeRecord = sessions.find((session) => session.id === activeSession) ?? null
    if (!activeSession || !activeRecord) {
      const created: ChatSession = {
        id: createId(),
        profile_id: profile.id,
        title: content.slice(0, 18),
        created_at: timestamp,
        updated_at: timestamp,
      }
      await saveSession(created)
      activeSession = created.id
      activeRecord = created
      setSessionId(created.id)
      setSessions((current) => [created, ...current])
    }

    const userMessage: ChatMessage = {
      id: createId(),
      session_id: activeSession,
      role: 'user',
      content,
      created_at: timestamp,
    }
    await saveMessage(userMessage)
    const history = [...messages, userMessage]
    setMessages(history)
    setDraft('')

    const chart = computeChart(profile)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const reply = await streamChat({
        model: settings.model === 'deepseek-reasoner' ? 'deepseek-reasoner' : 'deepseek-chat',
        signal: controller.signal,
        onDelta: (update) => {
          setStreaming(update.content)
          setStreamingReasoning(update.reasoning)
        },
        messages: [
          { role: 'system', content: buildSystemPrompt(profile, chart) },
          ...history.slice(-40).map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      })
      const text = reply.content.trim()
      const thought = reply.reasoning.trim()
      if (!text) {
        setError('这次没有生成内容，可以换种说法再试。')
        return
      }
      const assistant: ChatMessage = {
        id: createId(),
        session_id: activeSession,
        role: 'assistant',
        content: text,
        ...(thought ? { reasoning: thought } : {}),
        created_at: nowIso(),
      }
      await saveMessage(assistant)
      const touched: ChatSession = {
        ...activeRecord,
        updated_at: assistant.created_at,
        title: activeRecord.title || content.slice(0, 18),
      }
      await saveSession(touched)
      setMessages((current) => [...current, assistant])
      setStreaming('')
      setStreamingReasoning('')
      setSessions((current) =>
        current
          .map((session) =>
            session.id === activeSession ? { ...session, updated_at: assistant.created_at } : session,
          )
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
      )
    } catch (sendError) {
      if (sendError instanceof DOMException && sendError.name === 'AbortError') {
        setError('已停下来。')
        return
      }
      setError(sendError instanceof Error ? sendError.message : '聊天没有完成。')
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function Thought({ text, open = false }: { text: string; open?: boolean }) {
    return (
      <Collapsible defaultIsOpen={open} trigger={<Text type="supporting">思考过程</Text>}>
        <MarkdownText text={text} tone="secondary" />
      </Collapsible>
    )
  }

  function stop() {
    abortRef.current?.abort()
  }

  if (status === 'loading') return <Text type="supporting">正在准备对话…</Text>

  if (profiles.length === 0) {
    return (
      <EmptyState
        title="先有一个档案，再聊"
        description="聊天会带上这个人的四柱，当作性格和节奏的比喻。"
        actions={<Button label="新建档案" variant="primary" onClick={() => navigate('/profiles/new')} />}
      />
    )
  }

  if (!profile || status === 'missing') {
    return (
      <EmptyState
        title="没有这份档案"
        actions={<Button label="回到档案" variant="primary" onClick={() => navigate('/')} />}
      />
    )
  }

  return (
    <div {...stylex.props(styles.chatScreen)}>
      <div {...stylex.props(styles.chatToolbar)}>
        <Heading level={2}>和{profile.display_name}聊聊</Heading>
        <Text type="supporting">
          小闲会带上这张盘的机器排盘。问批盘或运势时，它按日主、十神、五行、格局、大运、流年来写；聊今天的事，就短一些。
        </Text>
        <Selector
          label="档案"
          options={profiles.map((item) => ({
            value: item.id,
            label: item.display_name,
            description: formatBirth(item),
          }))}
          value={profile.id}
          onChange={(value) => {
            if (value && value !== profile.id) navigate(`/chat/${value}`)
          }}
        />
        <div {...stylex.props(styles.sessionRow)}>
          <Button
            label="新对话"
            variant="secondary"
            size="sm"
            onClick={() => {
              setSessionId(null)
              setMessages([])
              setStreaming('')
              setStreamingReasoning('')
              setError('')
            }}
            isDisabled={busy}
          />
          {sessions.map((session) => (
            <Button
              key={session.id}
              label={session.title || '未命名'}
              size="sm"
              variant={session.id === sessionId ? 'primary' : 'ghost'}
              onClick={() => setSessionId(session.id)}
              isDisabled={busy}
            />
          ))}
        </div>
        {offline ? (
          <Banner
            status="warning"
            title="云端暂时连不上"
            description="对话记录先看这台设备上的缓存。发送需要网络。"
            collapsible={false}
          />
        ) : null}
      </div>
      <div ref={listRef} {...stylex.props(styles.messages)} data-chat-messages>
        {messages.length === 0 && !streaming ? (
          <Text type="supporting">比如：今天开会有点顶，我想看看这更像性格，还是只是没睡够。</Text>
        ) : null}
        {messages.map((message) => (
          <Card
            key={message.id}
            padding={3}
            variant={message.role === 'user' ? 'muted' : 'default'}
            xstyle={message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}
          >
            <VStack gap={1}>
              <Text type="supporting">{message.role === 'user' ? profile.display_name : '小闲'}</Text>
              {message.reasoning ? <Thought text={message.reasoning} /> : null}
              {message.role === 'assistant' ? (
                <MarkdownText text={message.content} />
              ) : (
                <Text {...stylex.props(styles.prose)}>{message.content}</Text>
              )}
            </VStack>
          </Card>
        ))}
        {busy || streaming || streamingReasoning ? (
          <Card padding={3} xstyle={styles.bubbleAssistant}>
            <VStack gap={1}>
              <Text type="supporting">小闲</Text>
              {streamingReasoning ? <Thought text={streamingReasoning} open /> : null}
              {streaming ? <MarkdownText text={streaming} /> : <Text {...stylex.props(styles.prose)}>在想怎么说…</Text>}
            </VStack>
          </Card>
        ) : null}
      </div>
      <div {...stylex.props(styles.composer)} data-chat-composer>
        {error ? <Banner status="error" title="这次没聊完" description={error} collapsible={false} /> : null}
        <TextArea
          label="今天想聊的"
          value={draft}
          onChange={setDraft}
          rows={3}
          placeholder="写一件具体的事，比问「我今年运气如何」更有用。"
          isDisabled={busy}
          onFocus={() => {
            const list = listRef.current
            if (list) list.scrollTop = list.scrollHeight
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <HStack gap={2}>
          <Button
            label={busy ? '正在回复' : '发送'}
            variant="primary"
            onClick={() => void send()}
            isDisabled={busy || draft.trim().length === 0}
          />
          {busy ? <Button label="停止" variant="secondary" onClick={stop} /> : null}
        </HStack>
      </div>
    </div>
  )
}
