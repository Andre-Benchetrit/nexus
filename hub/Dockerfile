FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY hub/package.json ./hub/package.json
COPY services/nexus-api/package.json ./services/nexus-api/package.json
RUN npm ci
COPY hub ./hub
RUN npm run nexus:hub:build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/hub/.next/standalone ./
COPY --from=builder /app/hub/.next/static ./hub/.next/static
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "hub/server.js"]
