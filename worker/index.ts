import { authenticate } from './access.ts'
import { handleChat } from './chat.ts'
import { handleData } from './data.ts'
import { HttpError, jsonError, logError } from './http.ts'

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }
    const auth = await authenticate(request, env)
    if (auth instanceof Response) return auth
    try {
      if (url.pathname === '/api/chat') {
        if (request.method !== 'POST') return jsonError(405, '只接受 POST。')
        return await handleChat(request, env)
      }
      return await handleData(request, env, url, auth.email)
    } catch (error) {
      if (error instanceof HttpError) return jsonError(error.status, error.message)
      logError({
        message: 'api failed',
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      })
      return jsonError(500, '服务暂时处理不了这个请求。')
    }
  },
} satisfies ExportedHandler<Env>
