# Build context: repository root (see docker-compose.yml).
FROM node:24-alpine AS build
WORKDIR /app
# Every workspace manifest is needed for `npm ci` to match the shared lockfile.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @elevate/web --include-workspace-root
COPY tsconfig.base.json ./
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
# The /api rewrite target is baked in at build time (standalone output).
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN npm run build -w @elevate/web

# Standalone output already contains the minimal node_modules the server needs.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
