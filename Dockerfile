# Clearline — single container.
#
# The database is a SQLite file. On Render's free plan there is no persistent
# disk, so `scripts/boot.ts` restores a committed snapshot of a real extraction
# run on every cold start. Point LIBSQL_URL at a Turso database instead and the
# same image becomes genuinely durable with no code change.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/data ./data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
ENV PORT=3000

# `prestart` runs scripts/boot.ts: restore the snapshot, or seed, then serve.
CMD ["npm", "run", "start"]
