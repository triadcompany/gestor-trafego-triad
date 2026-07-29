FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.output ./.output
RUN npm install --prefix ./.output/server --omit=dev

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
