import { sign, verify } from 'hono/jwt'

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export interface AuthTokenPayload {
  sub: string
  exp: number
  [key: string]: unknown
}

export async function createAuthToken(profileId: string, secret: string): Promise<string> {
  const payload: AuthTokenPayload = {
    sub: profileId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  }
  return sign(payload, secret)
}

export async function verifyAuthToken(token: string, secret: string): Promise<AuthTokenPayload> {
  return verify(token, secret, 'HS256') as Promise<AuthTokenPayload>
}
