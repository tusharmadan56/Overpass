FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY config.yaml ./

ENV NODE_ENV=production
ENV GATEWAY_PORT=8080

EXPOSE 8080

CMD ["node", "src/index.js"]
