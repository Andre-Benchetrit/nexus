FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY hub/package.json ./hub/package.json
COPY services/nexus-api/package.json ./services/nexus-api/package.json
COPY services/nexus-lake-worker/package.json ./services/nexus-lake-worker/package.json
COPY services/nexus-mcp-lab/package.json ./services/nexus-mcp-lab/package.json
RUN npm ci --omit=dev
COPY . .
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3010)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "services/nexus-mcp-lab/server.js"]
