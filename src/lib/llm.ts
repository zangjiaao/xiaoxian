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

export async function streamChat(options: {
  settings: LlmSettings
  messages: ChatTurn[]
  onDelta: (text: string) => void
  signal?: AbortSignal
}): Promise<string> {
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
    return readWhole(body, apiKey)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const piece = takeDelta(line, apiKey)
      if (!piece) continue
      full += piece
      options.onDelta(full)
    }
  }
  if (buffer.trim()) {
    const piece = takeDelta(buffer, apiKey)
    if (piece) {
      full += piece
      options.onDelta(full)
    }
  }
  return full
}

function readWhole(body: string, apiKey: string): string {
  try {
    const parsed = JSON.parse(body) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return parsed.choices?.[0]?.message?.content ?? ''
  } catch {
    throw new Error(sanitize(body, apiKey) || '模型没有返回可读内容。')
  }
}

function takeDelta(line: string, apiKey: string): string {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return ''
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return ''
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
    }
    const choice = parsed.choices?.[0]
    return choice?.delta?.content ?? choice?.message?.content ?? ''
  } catch {
    throw new Error(sanitize(data, apiKey) || '流式回复解析失败。')
  }
}
