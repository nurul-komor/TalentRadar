import { webcrypto } from 'node:crypto'

const ITERATIONS = 100_000
const HASH_ALGORITHM = 'SHA-256'
const SALT_BYTES = 16
const KEY_LENGTH_BITS = 256

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<ArrayBuffer> {
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  return webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: HASH_ALGORITHM },
    keyMaterial,
    KEY_LENGTH_BITS
  )
}

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES)
  webcrypto.getRandomValues(salt)
  const derived = await deriveBits(password, salt, ITERATIONS)
  return `pbkdf2:${ITERATIONS}:${toHex(salt)}:${toHex(derived)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsStr, saltHex, hashHex] = stored.split(':')
  if (scheme !== 'pbkdf2') return false
  const iterations = Number(iterationsStr)
  const salt = fromHex(saltHex)
  const derived = await deriveBits(password, salt, iterations)
  return toHex(derived) === hashHex
}
