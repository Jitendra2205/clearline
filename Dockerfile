# Clearline — single container, SQLite on a mounted disk.
#
# The database is a file. Point LIBSQL_URL at a path on a persistent disk
# (render.yaml uses file:/var/data/clearline.db) and the RFx, extractions,
# review resolutions and audit trail survive restarts and redeploys. No
# external database to provision.
#
# Note the disk must NOT be mounted at /app/data — that directory holds the
# vendor document fixtures baked into the image, and a mount would hide them.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Fixtures are generated at build time so the demo dataset ships with the image
# and ground_truth.json stays in lockstep with the vendor documents.
RUN npx tsx scripts/make-fixtures.ts && npm run build

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

RUN mkdir -p /var/data && chown -R node:node /var/data /app/data
USER node

EXPOSE 3000
ENV PORT=3000

# `prestart` seeds the demo RFx if the database is empty, then next starts.
# Seeding is a no-op on every boot after the first.
CMD ["npm", "run", "start"]
