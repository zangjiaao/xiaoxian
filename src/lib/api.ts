export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError(0, '连不上云端。这台设备上如果有缓存，排盘仍可以看。')
  }

  if (response.status === 204) return undefined as T
  const text = await response.text()
  if (!response.ok) {
    let message = `请求失败（${response.status}）`
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      if (text.trim()) message = text.trim().slice(0, 240)
    }
    if (response.status === 401 && message === `请求失败（${response.status}）`) {
      message = '需要登录。刷新页面后再试。'
    }
    throw new ApiError(response.status, message)
  }
  if (!text) return undefined as T
  return JSON.parse(text) as T
}
