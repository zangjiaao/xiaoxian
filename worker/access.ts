import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { jsonError } from './http.ts'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CERTS_SUFFIX = /\/cdn-cgi\/access\/certs$/i
const jwksByIssuer = new Map<string, JWTVerifyGetKey>()

// 只返回团队源站。JWT iss 用它，证书地址是 `{源站}/cdn-cgi/access/certs`。
export function accessIssuer(teamDomain: string): string {
  let trimmed = teamDomain.trim().replace(/\/+$/, '')
  trimmed = trimmed.replace(CERTS_SUFFIX, '').replace(/\/+$/, '')
  if (!trimmed) throw new Error('missing team domain')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withScheme)
  if (url.protocol !== 'https:') throw new Error('team domain must be https')
  return url.origin
}

function remoteKeys(issuer: string): JWTVerifyGetKey {
  const cached = jwksByIssuer.get(issuer)
  if (cached) return cached
  const created = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  jwksByIssuer.set(issuer, created)
  return created
}

export async function emailFromAccessJwt(
  token: string,
  options: { teamDomain: string; aud: string; getKey?: JWTVerifyGetKey },
): Promise<string> {
  const issuer = accessIssuer(options.teamDomain)
  const aud = options.aud.trim()
  if (!aud) throw new Error('missing aud')
  const { payload } = await jwtVerify(token, options.getKey ?? remoteKeys(issuer), {
    issuer,
    audience: aud,
    algorithms: ['RS256'],
    clockTolerance: 30,
  })
  const email = payload['email']
  if (typeof email !== 'string') throw new Error('missing email')
  const normalized = email.trim().toLowerCase()
  if (!EMAIL_RE.test(normalized)) throw new Error('bad email')
  return normalized
}

export function localDevEmail(request: Request, configured: string): string | null {
  const email = configured.trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) return null
  let hostname = ''
  try {
    hostname = new URL(request.url).hostname
  } catch {
    return null
  }
  if (!LOCAL_HOSTS.has(hostname)) return null
  return email
}

export async function authenticate(request: Request, env: Env): Promise<{ email: string } | Response> {
  const dev = localDevEmail(request, env.DEV_USER_EMAIL)
  if (dev) return { email: dev }

  const token = request.headers.get('Cf-Access-Jwt-Assertion')?.trim()
  if (!token) return jsonError(401, '需要登录。')
  if (!env.ACCESS_TEAM_DOMAIN.trim() || !env.ACCESS_AUD.trim()) {
    return jsonError(401, 'Access 还没配好。')
  }
  try {
    const email = await emailFromAccessJwt(token, {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
    })
    return { email }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ message: 'access jwt rejected', error: detail.slice(0, 200) }))
    return jsonError(401, '登录已失效。')
  }
}
