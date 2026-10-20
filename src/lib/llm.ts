import type { LlmSettings } from '../types.ts'

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function completionsUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

function sanitize(message: string, apiKey: string): string {
  const cleaned = apiKey ? message.split(apiKey).join('***') : message
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 280)
}

function explainStatus(status: number, body: string, apiKey: string): string {
  if (status === 401) return '密钥好像不被接受。去设置里核对一下，它只保存在这台设备上。'
  if (status === 402) return '模型账户余额不足，聊天先停一下。排盘仍然可以离线看。'
  if (status === 429) return '请求有点频繁，歇一会儿再试。'
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    if (parsed.error?.message) detail = sanitize(parsed.error.message, apiKey)
  } catch {
    detail = sanitize(body, apiKey)
  }
  if (!detail) return `模型服务返回了 ${status}。`
  return `模型服务返回了 ${status}：${detail}`
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
  settings: LlmSettings
  messages: ChatTurn[]
  onDelta: (update: ChatStream) => void
  signal?: AbortSignal
}): Promise<ChatStream> {
  const apiKey = options.settings.apiKey.trim()
  if (!apiKey) {
    throw new Error('还没有填写 API Key。到设置页粘贴一把 DeepSeek 密钥即可。')
  }

  let response: Response
  try {
    response = await fetch(completionsUrl(options.settings.baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.settings.model.trim() || 'deepseek-chat',
        stream: true,
        messages: options.messages,
      }),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('连不上模型服务。排盘不需要网络，聊天需要。')
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(explainStatus(response.status, body, apiKey))
  }

  if (!response.body) {
    const body = await response.text()
    const whole = readWhole(body, apiKey)
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
    for (const line of lines) emit(takeDelta(line, apiKey))
  }
  if (buffer.trim()) emit(takeDelta(buffer, apiKey))
  return { content, reasoning }
}

function readWhole(body: string, apiKey: string): ChatStream {
  try {
    return parseCompletionPayload(body)
  } catch {
    throw new Error(sanitize(body, apiKey) || '模型没有返回可读内容。')
  }
}

function takeDelta(line: string, apiKey: string): CompletionDelta {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return { content: '', reasoning: '' }
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return { content: '', reasoning: '' }
  try {
    return parseCompletionPayload(data)
  } catch {
    throw new Error(sanitize(data, apiKey) || '流式回复解析失败。')
  }
}
