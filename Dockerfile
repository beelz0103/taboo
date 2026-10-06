FROM node:22-alpine

WORKDIR /app

ENV HOST=0.0.0.0 \
    PORT=7331 \
    PLAYED_STORE=/app/.taboo-data/played-cards.json

COPY --chown=node:node server.js index.html japanese-master.js ./

RUN mkdir -p /app/.taboo-data && chown node:node /app/.taboo-data

USER node

EXPOSE 7331

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:7331/health || exit 1

CMD ["node", "server.js"]
