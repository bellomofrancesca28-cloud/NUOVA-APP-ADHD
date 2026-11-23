# Immagine di produzione di ADHD Coach (Node 20 + Express, database PostgreSQL esterno).
# Build senza Docker locale, direttamente in Azure Container Registry:
#   az acr build -r crorel01 -t spm-adhd-coach:<versione> .
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Prima solo le dipendenze, così il livello resta in cache se cambia solo il codice.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY server ./server

# L'app non scrive file sul disco del container: foto profilo e CV dei tutor
# vanno in Azure Blob Storage (vedi server/storage.js).

# La Container App espone la porta 80 (PORT=80, ingress targetPort 80). Un
# utente non root normalmente non può aprire porte < 1024: diamo al solo
# eseguibile di Node il permesso specifico per farlo, invece di girare come root.
RUN apk add --no-cache libcap \
 && setcap cap_net_bind_service=+ep "$(readlink -f /usr/local/bin/node)" \
 && apk del libcap

USER node
EXPOSE 80
CMD ["node", "server/index.js"]
