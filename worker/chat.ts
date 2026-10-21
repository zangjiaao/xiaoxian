import { isLlmModel } from '../src/lib/models.ts'
import { HttpError, jsonError, logError, logInfo, readJson } from './http.ts'
import { parseChatRequest } from './validate.ts'

function completionsUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '') || 'https://api.deepseek.com'
  const endpoint = trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
  const url = new URL(endpoint)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol === 'http:' && local) return url.toString()
  if (url.protocol === 'https:') return url.toString()
  throw new HttpError(500, 'DEEPSEEK_BASE_URL 不合法。')
}

function upstreamMessage(status: number, body: string): string {
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string }
    if (typeof parsed.error === 'string') detail = parsed.error
    else if (parsed.error && typeof parsed.error.message === 'string') detail = parsed.error.message
  } catch {
    detail = body
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (status === 401 || status === 403) return '模型密钥不被接受。请检查 Worker 的 DEEPSEEK_API_KEY。'
  if (status === 402) return '模型账户余额不足，聊天先停一下。排盘仍然可以看。'
  if (status === 429) return '模型请求有点频繁，歇一会儿再试。'
  if (!detail) return '模型服务暂时没有返回内容。'
  return `模型服务返回了 ${status}：${detail}`
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  if (!env.DEEPSEEK_API_KEY?.trim()) return jsonError(503, '还没有配置模型密钥。')
  const fallback = isLlmModel(env.DEEPSEEK_MODEL) ? env.DEEPSEEK_MODEL : 'deepseek-chat'
  const { model, messages } = parseChatRequest(await readJson(request, 1_500_000), fallback)
  const url = completionsUrl(env.DEEPSEEK_BASE_URL)
  logInfo({ message: 'chat proxy', model })

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({ model, messages, stream: true }),
    })
  } catch (error) {
    logError({
      message: 'chat upstream unreachable',
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonError(502, '连不上模型服务。')
  }

  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text()
    const status = upstream.status === 402 || upstream.status === 429 ? upstream.status : 502
    return jsonError(status, upstreamMessage(upstream.status, body))
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
