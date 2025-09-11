# --- Dependencies stage ---
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
RUN npm run build

# --- Runtime stage ---
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
# Ensure Prisma Client in final image (node_modules copied from deps)
RUN npx prisma generate
EXPOSE 4000
CMD ["node", "dist/server.js"]