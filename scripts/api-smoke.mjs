import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

const port = 8787
const persist = path.resolve('.wrangler/api-smoke')
const devEmail = 'dev@example.com'
const otherId = '22222222-2222-4222-8222-222222222222'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function mockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404)
        res.end('nope')
        return
      }
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        if (req.headers.authorization !== 'Bearer test-key') {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'bad key' } }))
          return
        }
        const parsed = JSON.parse(body)
        if (parsed.stream !== true || parsed.model !== 'deepseek-reasoner') {
          res.writeHead(400)
          res.end('bad request')
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
        })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先看日主' } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '今天宜收尾' } }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('mock 没有端口')
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true' },
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('exit', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`${command} ${args.join(' ')} 退出 ${code}\n${output}`))
    })
  })
}

function request(method, requestPath, body, host) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body)
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers: {
          ...(host ? { Host: host } : {}),
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            type: res.headers['content-type'] ?? '',
          })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function jsonBody(response) {
  return JSON.parse(response.body)
}

const mock = await mockServer()
const envFile = path.join(tmpdir(), `xiaoxian-dev-${process.pid}.env`)
await writeFile(envFile, `DEV_USER_EMAIL=${devEmail}\nDEEPSEEK_API_KEY=test-key\nDEEPSEEK_BASE_URL=${mock.url}\n`)
await mkdir('dist', { recursive: true })

let dev
try {
  await run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'xiaoxian', '--local', '--persist-to', persist])
  await run('npx', [
    'wrangler',
    'd1',
    'execute',
    'xiaoxian',
    '--local',
    '--persist-to',
    persist,
    '--command',
    `INSERT OR REPLACE INTO profiles (id, user_email, display_name, gender, birth_year, birth_month, birth_day, birth_hour, birth_minute, birth_place, notes, created_at, updated_at) VALUES ('${otherId}', 'other@example.com', '别人', 'female', 1991, 1, 2, NULL, NULL, '', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`,
  ])

  dev = spawn(
    process.execPath,
    [
      'node_modules/wrangler/wrangler-dist/cli.js',
      'dev',
      '--port',
      String(port),
      '--inspector-port',
      '0',
      '--show-interactive-dev-session',
      'false',
      '--persist-to',
      persist,
      '--env-file',
      envFile,
      '--var',
      `DEEPSEEK_BASE_URL:${mock.url}`,
      '--var',
      `DEV_USER_EMAIL:${devEmail}`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, CI: 'true' } },
  )
  let log = ''
  const ready = new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`wrangler dev 没有起来\n${log}`))
    }, 45000)
    const onData = (chunk) => {
      log += chunk
      if (!settled && (log.includes(`http://127.0.0.1:${port}`) || log.includes(`http://localhost:${port}`))) {
        settled = true
        clearTimeout(timer)
        resolve()
      }
    }
    dev.stdout.on('data', onData)
    dev.stderr.on('data', onData)
    dev.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`wrangler dev 提前退出 ${code}\n${log}`))
    })
  })
  await ready

  const anon = await request('GET', '/api/me', null, 'example.com')
  assert(anon.status === 401, `非本机应 401，实际 ${anon.status} ${anon.body}`)

  const me = jsonBody(await request('GET', '/api/me'))
  assert(me.email === devEmail, `登录邮箱不对 ${JSON.stringify(me)}`)

  const hidden = await request('GET', `/api/profiles/${otherId}`)
  assert(hidden.status === 404, '不能读到别人的档案')
  const list = jsonBody(await request('GET', '/api/profiles'))
  assert(!list.some((row) => row.display_name === '别人'), '列表不应包含别人的档案')

  const profileId = '33333333-3333-4333-8333-333333333333'
  const stamp = '2026-10-21T00:00:00.000Z'
  const profile = {
    id: profileId,
    display_name: '阿树',
    gender: 'male',
    birth_year: 1990,
    birth_month: 3,
    birth_day: 4,
    birth_hour: 14,
    birth_minute: 30,
    birth_place: '杭州',
    notes: '本地导入测试',
    created_at: stamp,
    updated_at: stamp,
  }
  const saved = jsonBody(await request('PUT', `/api/profiles/${profileId}`, profile))
  assert(saved.display_name === '阿树', '档案没有保存')
  const fetched = jsonBody(await request('GET', `/api/profiles/${profileId}`))
  assert(fetched.birth_place === '杭州', '档案读不回来')

  const hijack = await request('PUT', `/api/profiles/${otherId}`, { ...profile, id: otherId, display_name: '改掉别人' })
  assert(hijack.status === 404, '不能改别人的档案')

  const settings = jsonBody(await request('PUT', '/api/settings', { model: 'deepseek-reasoner' }))
  assert(settings.model === 'deepseek-reasoner' && settings.email === devEmail, '模型没有保存')

  const sessionId = '44444444-4444-4444-8444-444444444444'
  const messageId = '55555555-5555-4555-8555-555555555555'
  await request('PUT', `/api/sessions/${sessionId}`, {
    id: sessionId,
    profile_id: profileId,
    title: '开会',
    created_at: stamp,
    updated_at: stamp,
  })
  const message = jsonBody(
    await request('PUT', `/api/sessions/${sessionId}/messages/${messageId}`, {
      id: messageId,
      session_id: sessionId,
      role: 'assistant',
      content: '先这样看',
      reasoning: '想了一下',
      created_at: stamp,
    }),
  )
  assert(message.reasoning === '想了一下', '思考过程没有存下来')
  const messages = jsonBody(await request('GET', `/api/sessions/${sessionId}/messages`))
  assert(messages.length === 1 && messages[0].reasoning === '想了一下', '消息列表不对')

  const chart = jsonBody(
    await request('PUT', `/api/charts/${profileId}`, {
      id: profileId,
      profile_id: profileId,
      computed_at: stamp,
      clock_mode: 'civil',
      payload_json: JSON.stringify({ clockMode: 'civil' }),
    }),
  )
  assert(chart.profile_id === profileId, '命盘缓存没有写上')

  const imported = jsonBody(
    await request('POST', '/api/import', {
      profiles: [
        {
          ...profile,
          id: '66666666-6666-4666-8666-666666666666',
          display_name: '旧档案',
        },
      ],
      settings: [{ key: 'llm', value_json: JSON.stringify({ apiKey: 'sk-local-secret', model: 'deepseek-chat' }) }],
    }),
  )
  assert(imported.profiles === 1, `导入档案数量不对 ${JSON.stringify(imported)}`)
  const afterImport = jsonBody(await request('GET', '/api/settings'))
  assert(afterImport.model === 'deepseek-chat', '导入应覆盖模型，且只留模型名')
  const names = jsonBody(await request('GET', '/api/profiles')).map((row) => row.display_name)
  assert(names.includes('旧档案') && names.includes('阿树') && !names.includes('别人'), `档案列表不对 ${names.join(',')}`)

  const removed = await request('DELETE', `/api/profiles/${profileId}`)
  assert(removed.status === 200, '删除档案失败')
  const goneSession = await request('GET', `/api/sessions/${sessionId}`)
  assert(goneSession.status === 404, '删档案时应一并删掉会话')

  const badModel = await request('POST', '/api/chat', {
    model: 'gpt-4',
    messages: [{ role: 'user', content: '你好' }],
  })
  assert(badModel.status === 400, `非法模型应 400，实际 ${badModel.status}`)

  const chat = await request('POST', '/api/chat', {
    model: 'deepseek-reasoner',
    messages: [{ role: 'user', content: '今天开会有点顶' }],
  })
  assert(chat.status === 200, `聊天失败 ${chat.status} ${chat.body}`)
  assert(chat.type.includes('text/event-stream'), `不是 SSE：${chat.type}`)
  assert(chat.body.includes('先看日主') && chat.body.includes('今天宜收尾') && chat.body.includes('[DONE]'), 'SSE 没有透传')

  const missing = await request('GET', '/api/nope')
  assert(missing.status === 404, '未知接口应 404')

  console.log('api smoke ok')
} finally {
  if (dev?.pid) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000)
      dev.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      try {
        process.kill(-dev.pid, 'SIGKILL')
      } catch {
        dev.kill('SIGKILL')
      }
    })
  }
  await new Promise((resolve) => mock.server.close(() => resolve()))
}

const stored = await run('npx', [
  'wrangler',
  'd1',
  'execute',
  'xiaoxian',
  '--local',
  '--persist-to',
  persist,
  '--json',
  '--command',
  `SELECT value_json FROM settings WHERE user_email = '${devEmail}' AND key = 'llm';`,
])
assert(!stored.includes('sk-local-secret') && !stored.includes('apiKey'), `密钥被写进了 D1：${stored}`)
assert(stored.includes('deepseek-chat'), `导入后的模型不对：${stored}`)
