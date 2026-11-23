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

# Foto profilo e CV dei tutor vanno in Azure Blob Storage (vedi server/storage.js).
# Finché lo storage non è configurato l'app usa il disco locale (server/data/files,
# temporaneo: i file si perdono al riavvio): la cartella deve esistere ed essere
# scrivibile dall'utente non root con cui gira il processo.
# I file vengono copiati con i permessi che hanno sul computer da cui parte la
# build: se uno fosse 600, l'utente node non potrebbe leggerlo e l'app non
# partirebbe. Rendiamo tutto il codice leggibile (file) e attraversabile
# (cartelle) da tutti; resta di proprietà di root, quindi non modificabile
# dal processo dell'app.
RUN chmod -R a+rX /app \
 && mkdir -p server/data/files/avatars server/data/files/cv \
 && chown -R node:node server/data

USER node
# La Container App usa PORT=3000 (ingress targetPort 3000); l'app ascolta su PORT.
EXPOSE 3000
CMD ["node", "server/index.js"]
