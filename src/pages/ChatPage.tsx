import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { DropdownMenu, type DropdownMenuTriggerProps } from '@astryxdesign/core/DropdownMenu'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { VStack } from '@astryxdesign/core/VStack'
import { useMediaQuery } from '@astryxdesign/core/hooks'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { useEffect, useLayoutEffect, useRef, type SVGProps } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MarkdownText } from '../components/MarkdownText.tsx'
import { formatBirth } from '../lib/birth.ts'
import {
  focusProfile,
  readScroll,
  rememberScroll,
  selectSession,
  sendChat,
  startNewChat,
  stopStream,
  updateDraft,
  useMemorySelector,
  warmCache,
} from '../lib/memory.ts'
import { styles } from '../styles.ts'

function ComposeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" {...props}>
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  )
}

function PickerTrigger({
  label,
  text,
  pickerStyle,
  triggerProps,
  isDisabled,
}: {
  label: string
  text: string
  pickerStyle: StyleXStyles
  triggerProps: DropdownMenuTriggerProps
  isDisabled?: boolean
}) {
  return (
    <button
      type="button"
      {...triggerProps}
      aria-label={label}
      disabled={isDisabled}
      {...stylex.props(styles.chatPicker, pickerStyle)}
    >
      <span {...stylex.props(styles.chatPickerLabel)}>{text}</span>
      <Icon icon="chevronDown" size="sm" />
    </button>
  )
}

function distanceFromBottom(list: HTMLDivElement): number {
  return list.scrollHeight - list.scrollTop - list.clientHeight
}

export function ChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const booted = useMemorySelector((state) => state.booted)
  const profiles = useMemorySelector((state) => state.profiles)
  const profilesStatus = useMemorySelector((state) => state.profilesStatus)
  const lastProfileId = useMemorySelector((state) => state.settings?.lastProfileId ?? null)
  const offline = useMemorySelector((state) => state.offline)
  const sessions = useMemorySelector((state) => (id ? state.sessions[id] : undefined))
  const sessionsStatus = useMemorySelector((state) => (id ? state.sessionsStatus[id] : undefined))
  const sessionChoice = useMemorySelector((state) => (id ? state.chat.sessionByProfile[id] : undefined))
  const messages = useMemorySelector((state) =>
    sessionChoice ? state.messages[sessionChoice] : undefined,
  )
  const draft = useMemorySelector((state) => (id ? (state.chat.draftByProfile[id] ?? '') : ''))
  const error = useMemorySelector((state) => state.chat.error)
  const stream = useMemorySelector((state) => state.stream)
  const profile = profiles?.find((item) => item.id === id) ?? null
  const busy = Boolean(stream?.busy)
  const showStream = Boolean(
    stream && sessionChoice && stream.sessionId === sessionChoice && (stream.busy || stream.content || stream.reasoning),
  )
  const listRef = useRef<HTMLDivElement | null>(null)
  const appliedScrollKey = useRef<string | null>(null)
  const sticking = useRef(false)
  const narrow = useMediaQuery('(max-width: 768px)')
  const menuPresentation = narrow ? 'bottom-sheet' : 'popover'
  const scrollKey = sessionChoice ? sessionChoice : id ? `new:${id}` : ''

  useEffect(() => {
    document.title = '聊聊 · 小闲'
    void warmCache()
  }, [])

  useEffect(() => {
    if (id || profilesStatus !== 'ready' || !profiles || profiles.length === 0) return
    const target = profiles.find((item) => item.id === lastProfileId)?.id ?? profiles[0]?.id
    if (target) navigate(`/chat/${target}`, { replace: true })
  }, [id, lastProfileId, navigate, profiles, profilesStatus])

  useEffect(() => {
    if (!id || !profile) return
    focusProfile(id)
  }, [id, profile])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || !scrollKey) return
    const saved = readScroll(scrollKey)
    const entered = appliedScrollKey.current !== scrollKey
    appliedScrollKey.current = scrollKey
    const follow = entered ? saved.followBottom : readScroll(scrollKey).followBottom
    if (!entered && !follow) return
    sticking.current = true
    list.scrollTop = follow ? list.scrollHeight : saved.top
    rememberScroll(scrollKey, list.scrollTop, Boolean(follow))
    requestAnimationFrame(() => {
      sticking.current = false
    })
  }, [messages, scrollKey, stream?.content, stream?.reasoning, showStream])

  function onMessagesScroll() {
    if (sticking.current) return
    const list = listRef.current
    if (!list || !scrollKey) return
    rememberScroll(scrollKey, list.scrollTop, distanceFromBottom(list) < 64)
  }

  if (!booted && !profile && !profiles) return null

  if ((profilesStatus !== 'ready' || !profiles) && !profile) {
    return <Text type="supporting">正在准备对话…</Text>
  }

  if (profilesStatus === 'error' && !profile) {
    return <EmptyState title="对话页打不开" description={error || '云端暂时没有回应。'} />
  }

  if (!profiles || profiles.length === 0) {
    return (
      <EmptyState
        title="先有一个档案，再聊"
        description="聊天会带上这个人的四柱，当作性格和节奏的比喻。"
        actions={<Button label="新建档案" variant="primary" onClick={() => navigate('/profiles/new')} />}
      />
    )
  }

  if (!id || !profile) {
    if (!id || profilesStatus !== 'ready') return <Text type="supporting">正在准备对话…</Text>
    return (
      <EmptyState
        title="没有这份档案"
        actions={<Button label="回到档案" variant="primary" onClick={() => navigate('/')} />}
      />
    )
  }

  if (sessionsStatus === 'error' && !sessions) {
    return (
      <EmptyState
        title="对话页打不开"
        description={error || '云端暂时没有回应。'}
        actions={<Button label="回到档案" variant="primary" onClick={() => navigate('/')} />}
      />
    )
  }

  if (!sessions || sessionChoice === undefined) {
    return <Text type="supporting">正在准备对话…</Text>
  }

  const activeSession = sessions.find((session) => session.id === sessionChoice) ?? null
  const sessionTitle = activeSession?.title || '新对话'
  const visibleMessages = sessionChoice ? (messages ?? []) : []
  const waitingForMessages = Boolean(sessionChoice && !messages && !showStream)

  return (
    <div {...stylex.props(styles.chatScreen)}>
      <div {...stylex.props(styles.chatTop)}>
        <div {...stylex.props(styles.chatBar)} data-chat-toolbar>
          <DropdownMenu
            presentation={menuPresentation}
            alignment="start"
            menuWidth={280}
            button={{ label: '切换档案' }}
            items={profiles.map((item) => ({
              id: item.id,
              label: item.display_name,
              description: formatBirth(item),
              endContent: item.id === profile.id ? <Icon icon="check" size="sm" /> : undefined,
              onClick: () => {
                if (item.id !== profile.id) navigate(`/chat/${item.id}`)
              },
            }))}
            renderTrigger={(triggerProps) => (
              <PickerTrigger
                label={`切换档案，当前${profile.display_name}`}
                text={profile.display_name}
                pickerStyle={styles.chatPickerProfile}
                triggerProps={triggerProps}
                isDisabled={busy}
              />
            )}
          />
          <DropdownMenu
            presentation={menuPresentation}
            alignment="end"
            menuWidth={280}
            button={{ label: '历史对话' }}
            items={
              sessions.length === 0
                ? [{ id: 'empty', label: '还没有历史对话', isDisabled: true }]
                : sessions.map((session) => ({
                    id: session.id,
                    label: session.title || '未命名',
                    endContent: session.id === sessionChoice ? <Icon icon="check" size="sm" /> : undefined,
                    isDisabled: busy,
                    onClick: () => selectSession(session.id),
                  }))
            }
            renderTrigger={(triggerProps) => (
              <PickerTrigger
                label={`历史对话，当前${sessionTitle}`}
                text={sessionTitle}
                pickerStyle={styles.chatPickerSession}
                triggerProps={triggerProps}
                isDisabled={busy}
              />
            )}
          />
          <IconButton
            label="新对话"
            icon={<Icon icon={ComposeIcon} size="md" />}
            variant="ghost"
            size="lg"
            xstyle={styles.chatNew}
            onClick={startNewChat}
            isDisabled={busy}
          />
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
      <div ref={listRef} {...stylex.props(styles.messages)} data-chat-messages onScroll={onMessagesScroll}>
        {waitingForMessages ? <Text type="supporting">正在准备对话…</Text> : null}
        {!waitingForMessages && visibleMessages.length === 0 && !showStream ? (
          <Text type="supporting">比如：今天开会有点顶，我想看看这更像性格，还是只是没睡够。</Text>
        ) : null}
        {visibleMessages.map((message) => (
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
        {showStream && stream ? (
          <Card padding={3} xstyle={styles.bubbleAssistant}>
            <VStack gap={1}>
              <Text type="supporting">小闲</Text>
              {stream.reasoning ? <Thought text={stream.reasoning} open /> : null}
              {stream.content ? (
                <MarkdownText text={stream.content} />
              ) : (
                <Text {...stylex.props(styles.prose)}>在想怎么说…</Text>
              )}
            </VStack>
          </Card>
        ) : null}
      </div>
      <div {...stylex.props(styles.composer)} data-chat-composer>
        {error ? <Banner status="error" title="这次没聊完" description={error} collapsible={false} /> : null}
        <TextArea
          label="今天想聊的"
          value={draft}
          onChange={(value) => updateDraft(profile.id, value)}
          rows={3}
          placeholder="写一件具体的事，比问「我今年运气如何」更有用。"
          isDisabled={busy}
          onFocus={() => {
            const list = listRef.current
            if (!list || !scrollKey) return
            list.scrollTop = list.scrollHeight
            rememberScroll(scrollKey, list.scrollTop, true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendChat(profile)
            }
          }}
        />
        <HStack gap={2}>
          <Button
            label={busy ? '正在回复' : '发送'}
            variant="primary"
            onClick={() => void sendChat(profile)}
            isDisabled={busy || draft.trim().length === 0}
          />
          {busy ? <Button label="停止" variant="secondary" onClick={stopStream} /> : null}
        </HStack>
      </div>
    </div>
  )
}

function Thought({ text, open = false }: { text: string; open?: boolean }) {
  return (
    <Collapsible defaultIsOpen={open} trigger={<Text type="supporting">思考过程</Text>}>
      <MarkdownText text={text} tone="secondary" />
    </Collapsible>
  )
}
