FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# data/ et uploads/ sont montés en volumes — on crée les dossiers vides
RUN mkdir -p data/demo uploads/avatars uploads/team-logos

EXPOSE 3000

CMD ["node", "server.js"]
