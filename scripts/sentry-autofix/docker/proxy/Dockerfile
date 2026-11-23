# 인증 프록시 — Node 내장만, 비 root. auth.json 은 실행 시 읽기 전용 파일로만 마운트한다
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
COPY check.mjs server.mjs /app/
USER node
CMD ["node", "/app/server.mjs"]
