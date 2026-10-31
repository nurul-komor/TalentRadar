// Ambient shims for the DOM identifiers referenced inside Playwright
// `page.evaluate()` callbacks below. Those callbacks run in a real browser
// context at runtime (injected by Playwright), but this project's tsconfig
// deliberately omits the "DOM" lib: adding it conflicts with @types/node's
// WebCrypto `BufferSource` typing used by `../lib/password.ts`. These names
// only need to resolve for typecheck purposes — the automation modules don't
// depend on DOM lib's structural typing, just on `document`/`Element`/etc.
// being valid identifiers inside evaluate() closures.
declare const document: any
declare type Element = any
declare type HTMLInputElement = any
declare type HTMLTextAreaElement = any
