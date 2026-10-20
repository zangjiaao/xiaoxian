import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const name = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}

function png(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = paint(x + 0.5, y + 0.5, size)
      const i = row + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function inRoundRect(x, y, size, inset, radius) {
  const left = inset
  const right = size - inset
  const top = inset
  const bottom = size - inset
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function paint(x, y, size) {
  const ink = [31, 61, 54, 255]
  const paper = [244, 241, 234, 255]
  const clear = [0, 0, 0, 0]
  if (!inRoundRect(x, y, size, size * 0.06, size * 0.22)) return clear
  const gate = size * 0.62
  const left = (size - gate) / 2
  const top = size * 0.28
  const bar = size * 0.075
  const inTop = y >= top && y <= top + bar && x >= left && x <= left + gate
  const inLeft = x >= left && x <= left + bar && y >= top && y <= top + gate
  const inRight =
    x >= left + gate - bar && x <= left + gate && y >= top && y <= top + gate
  const cx = size / 2
  const cy = top + gate * 0.58
  const dx = x - cx
  const dy = y - cy
  const inDot = dx * dx + dy * dy <= (size * 0.055) ** 2
  if (inTop || inLeft || inRight || inDot) return paper
  return ink
}

writeFileSync('public/pwa-192.png', png(192, paint))
writeFileSync('public/pwa-512.png', png(512, paint))
writeFileSync('public/apple-touch-icon.png', png(180, paint))
