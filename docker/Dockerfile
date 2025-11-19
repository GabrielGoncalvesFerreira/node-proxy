FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# ===== DEV =====
FROM base AS dev
RUN npm install
COPY . .
EXPOSE 5180
EXPOSE 9229
# CORRIGIDO: Use a sintaxe de array JSON (exec form)
CMD ["npm", "run", "dev"]

# ===== PROD =====
FROM base AS prod
RUN npm install --production
COPY . .
EXPOSE 5180
CMD ["node", "src/servidor.js"]
