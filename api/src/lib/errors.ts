// Typed domain errors so route handlers can map failures to the correct HTTP
// status without string-matching free-text messages (see architect review
// finding 6). Services should only throw these two for expected domain
// conditions; anything else that escapes a service (a Claude API outage, a
// Mongo failure, a programming bug) is deliberately left as a plain/unknown
// error so the route layer's catch-all maps it to a 500 instead of masking
// it as a 404.

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}
