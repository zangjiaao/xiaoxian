import assert from 'node:assert/strict'
import { createLocalJWKSet, exportJWK, importJWK, SignJWT } from 'jose'
import { accessIssuer, emailFromAccessJwt, localDevEmail } from './access.ts'

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
)

const publicJwk = await exportJWK(publicKey)
publicJwk.alg = 'RS256'
publicJwk.kid = 'k1'
publicJwk.use = 'sig'
const privateJwk = await exportJWK(privateKey)
privateJwk.alg = 'RS256'
privateJwk.kid = 'k1'
const signingKey = await importJWK(privateJwk, 'RS256')
const getKey = createLocalJWKSet({ keys: [publicJwk] })
const issuer = 'https://team.cloudflareaccess.com'

async function sign(claims: Record<string, unknown>, overrides?: { aud?: string; exp?: number; iss?: string }) {
  const token = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(overrides?.iss ?? issuer)
    .setAudience(overrides?.aud ?? 'aud-1')
    .setIssuedAt()
  if (overrides?.exp != null) token.setExpirationTime(overrides.exp)
  else token.setExpirationTime('2h')
  return token.sign(signingKey)
}

const email = await emailFromAccessJwt(await sign({ email: 'Friend@Example.com' }), {
  teamDomain: 'team.cloudflareaccess.com',
  aud: 'aud-1',
  getKey,
})
assert.equal(email, 'friend@example.com')
assert.equal(accessIssuer('https://team.cloudflareaccess.com/'), issuer)
assert.equal(
  accessIssuer('https://delicate-bread-c32c.cloudflareaccess.com/cdn-cgi/access/certs/'),
  'https://delicate-bread-c32c.cloudflareaccess.com',
)
const pastedCerts = 'https://delicate-bread-c32c.cloudflareaccess.com/cdn-cgi/access/certs'
assert.equal(
  await emailFromAccessJwt(await sign({ email: 'a@b.co' }, { iss: accessIssuer(pastedCerts) }), {
    teamDomain: pastedCerts,
    aud: 'aud-1',
    getKey,
  }),
  'a@b.co',
)
await assert.rejects(
  async () =>
    emailFromAccessJwt(await sign({ email: 'a@b.co' }, { iss: pastedCerts }), {
      teamDomain: pastedCerts,
      aud: 'aud-1',
      getKey,
    }),
  /unexpected "iss" claim/i,
)

await assert.rejects(
  async () => emailFromAccessJwt(await sign({ email: 'friend@example.com' }), { teamDomain: issuer, aud: 'other', getKey }),
  /unexpected "aud" claim/i,
)
await assert.rejects(
  async () =>
    emailFromAccessJwt(await sign({ email: 'friend@example.com' }, { iss: 'https://other.cloudflareaccess.com' }), {
      teamDomain: issuer,
      aud: 'aud-1',
      getKey,
    }),
  /unexpected "iss" claim/i,
)
await assert.rejects(
  async () =>
    emailFromAccessJwt(await sign({ email: 'friend@example.com' }, { exp: Math.floor(Date.now() / 1000) - 120 }), {
      teamDomain: issuer,
      aud: 'aud-1',
      getKey,
    }),
  /exp/i,
)
await assert.rejects(
  async () => emailFromAccessJwt(await sign({ sub: 'no-email' }), { teamDomain: issuer, aud: 'aud-1', getKey }),
  /missing email/,
)

assert.equal(localDevEmail(new Request('http://localhost:8787/api/me'), 'Dev@Example.com'), 'dev@example.com')
assert.equal(localDevEmail(new Request('http://127.0.0.1:8787/api/me'), 'dev@example.com'), 'dev@example.com')
assert.equal(localDevEmail(new Request('https://xiaoxian.example.com/api/me'), 'dev@example.com'), null)
assert.equal(localDevEmail(new Request('http://localhost/api/me'), ''), null)
assert.equal(localDevEmail(new Request('http://localhost/api/me'), 'not-an-email'), null)

console.log('access smoke ok')
