// The pdf.js worker build ships no type declarations. We only import it to
// register `WorkerMessageHandler` on globalThis (see cvParser.ts), so an opaque
// module declaration is sufficient.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs'
