import type { LlmModel } from './models.ts'

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function sanitize(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 280)
}

function explainStatus(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string }
    if (parsed.error) return parsed.error
  } catch {
    const detail = sanitize(body)
    if (detail) return detail
  }
  if (status === 401) return '登录已失效，刷新页面后再试。'
  if (status === 402) return '模型账户余额不足，聊天先停一下。排盘仍然可以看。'
  if (status === 429) return '请求有点频繁，歇一会儿再试。'
  return `模型服务返回了 ${status}。`
}

export interface ChatStream {
  content: string
  reasoning: string
}

export interface CompletionDelta {
  content: string
  reasoning: string
}

export function parseCompletionPayload(data: string): CompletionDelta {
  const parsed = JSON.parse(data) as {
    choices?: Array<{
      delta?: { content?: string | null; reasoning_content?: string | null }
      message?: { content?: string | null; reasoning_content?: string | null }
    }>
  }
  const choice = parsed.choices?.[0]
  const source = choice?.delta ?? choice?.message
  const content = source?.content ?? ''
  const reasoning = source?.reasoning_content ?? ''
  return {
    content: typeof content === 'string' ? content : '',
    reasoning: typeof reasoning === 'string' ? reasoning : '',
  }
}

export async function streamChat(options: {
  model: LlmModel
  messages: ChatTurn[]
  onDelta: (update: ChatStream) => void
  signal?: AbortSignal
}): Promise<ChatStream> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        stream: true,
        messages: options.messages,
      }),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('连不上云端。排盘不需要网络，聊天需要。')
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(explainStatus(response.status, body))
  }

  if (!response.body) {
    const body = await response.text()
    const whole = readWhole(body)
    options.onDelta(whole)
    return whole
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  const emit = (piece: CompletionDelta) => {
    if (!piece.content && !piece.reasoning) return
    content += piece.content
    reasoning += piece.reasoning
    options.onDelta({ content, reasoning })
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) emit(takeDelta(line))
  }
  if (buffer.trim()) emit(takeDelta(buffer))
  return { content, reasoning }
}

function readWhole(body: string): ChatStream {
  try {
    return parseCompletionPayload(body)
  } catch {
    throw new Error(sanitize(body) || '模型没有返回可读内容。')
  }
}

function takeDelta(line: string): CompletionDelta {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return { content: '', reasoning: '' }
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return { content: '', reasoning: '' }
  try {
    return parseCompletionPayload(data)
  } catch {
    throw new Error(sanitize(data) || '流式回复解析失败。')
  }
}
