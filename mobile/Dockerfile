FROM node:22-slim
WORKDIR /app
COPY package*.json ./
# --ignore-scripts: nothing here needs a postinstall, and there is no .git in the image.
RUN npm ci --ignore-scripts
COPY . .
# EXPO_PUBLIC_* is inlined into the bundle at export time, so it has to be a build arg
# (the API's Cloud Run URL), not a runtime env var.
ARG EXPO_PUBLIC_API_URL
RUN npx expo export -p web
# Cloud Run injects PORT; server.js reads it.
CMD ["node", "server.js"]
