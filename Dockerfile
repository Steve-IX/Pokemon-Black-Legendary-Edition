# Ultra-lightweight Node.js production image
FROM node:20-alpine

WORKDIR /app

# Copy all static assets and server
COPY . .

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
