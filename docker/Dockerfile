FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# ===== DEV =====
FROM base AS dev
RUN npm install
COPY . .
EXPOSE 5180
EXPOSE 9229
# Dica: User node evita problemas de permissão com volumes no Linux
# USER node 
CMD ["npm", "run", "dev"]

# ===== PROD =====
FROM base AS prod
# 'npm ci' é mais rápido e seguro para CI/CD/Prod
RUN npm ci --only=production
COPY . .
# Boas práticas de segurança: rodar como usuário não-root
USER node
EXPOSE 5180
CMD ["node", "src/server.js"]