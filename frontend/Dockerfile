# --- Dependencies stage ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Allow docker-compose to pass API origin at build time (overrides .env.local)
ARG NEXT_PUBLIC_API_ORIGIN
ENV NEXT_PUBLIC_API_ORIGIN=${NEXT_PUBLIC_API_ORIGIN}
COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copy only what is needed to run
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "start"]