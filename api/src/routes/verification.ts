import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { runVerification } from '../verification/verificationService.js'
import type { JobVerifier } from '../verification/types.js'

export function createVerificationRoutes(db: Db, jwtSecret: string, verifier: JobVerifier) {
  const verificationRoutes = new Hono<{ Variables: AuthVariables }>()
  verificationRoutes.use('*', createRequireAuth(jwtSecret))

  verificationRoutes.post('/run', async (c) => {
    const result = await runVerification(db, verifier)
    return c.json(result)
  })

  return verificationRoutes
}
