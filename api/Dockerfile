FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# --ignore-scripts: `prepare` points git at .githooks, and there is no .git in the image.
# NODE_ENV=production would skip devDependencies, which `build` (tsc) needs.
RUN npm ci --ignore-scripts --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts
# Cloud Run injects PORT; server.ts reads it. schema.sql and migrations/ are only read by
# `npm run migrate` (tsx, a devDependency), which runs in the Cloud Build step -- not here.
CMD ["node", "dist/server.js"]
