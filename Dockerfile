FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV DB_PATH=/app/data/davomat.db
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "src/server.js"]
