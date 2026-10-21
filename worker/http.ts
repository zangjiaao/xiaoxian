export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export function jsonError(status: number, error: string): Response {
  return json({ error }, status)
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = request.headers.get('content-length')
  if (declared && Number(declared) > maxBytes) {
    throw new HttpError(413, '内容太长了。')
  }
  const text = await request.text()
  if (text.length > maxBytes) throw new HttpError(413, '内容太长了。')
  if (!text.trim()) throw new HttpError(400, '缺少请求内容。')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new HttpError(400, '请求不是 JSON。')
  }
}

export function logInfo(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields))
}

export function logError(fields: Record<string, unknown>): void {
  console.error(JSON.stringify(fields))
}
