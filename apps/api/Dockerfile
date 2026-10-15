# Build context: repository root (see docker-compose.yml).
FROM node:24-alpine AS build
WORKDIR /app
# Every workspace manifest is needed for `npm ci` to match the shared lockfile.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @elevate/api --include-workspace-root
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build -w @elevate/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @elevate/api --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
