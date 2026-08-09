# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig*.json ./
COPY apps ./apps
COPY libs ./libs
ARG APP_NAME
RUN test -n "$APP_NAME" && pnpm install --frozen-lockfile && pnpm nx build "$APP_NAME" --skip-nx-cache

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
ARG APP_NAME
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/${APP_NAME}/dist/main.js ./main.js
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "main.js"]
