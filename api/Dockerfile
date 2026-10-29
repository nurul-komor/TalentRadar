FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY api/package.json api/package.json
RUN npm ci --workspace=shared --workspace=api

RUN npx playwright install --with-deps chromium

COPY shared/ shared/
COPY api/ api/

# shared's package.json resolves "@job-hunter/shared" to dist/index.js, which
# is gitignored and only produced by this build step — api/src routes/services
# import from @job-hunter/shared, and tsx (used below) transpiles api's own
# TypeScript on the fly but does not build the shared workspace's output.
RUN npm run build --workspace=shared

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npx", "tsx", "api/src/server.ts"]
