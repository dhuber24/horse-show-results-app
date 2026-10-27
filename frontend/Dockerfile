# Same Node as Dockerfile.production, which says why it is pinned.
FROM node:24.22.1-alpine

WORKDIR /app

COPY package*.json .
RUN npm install

COPY . .

CMD ["npm", "run", "dev"]
