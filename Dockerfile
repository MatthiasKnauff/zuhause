# Zuhause – Smart-Home-Oberfläche auf openHAB. Keine Fremdpakete, nur Node.
FROM node:22-alpine
WORKDIR /app
COPY server ./server
COPY public ./public
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION DATEN=/daten PORT=8080 TZ=Europe/Berlin
VOLUME /daten
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/gesund || exit 1
CMD ["node", "server/index.js"]
