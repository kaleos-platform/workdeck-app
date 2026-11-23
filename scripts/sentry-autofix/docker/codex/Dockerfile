# 자동 수정 러너 샌드박스 이미지 — codex CLI 버전 고정, 비 root(node)
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl ripgrep && rm -rf /var/lib/apt/lists/*
RUN npm i -g @openai/codex@0.167.0
USER node
WORKDIR /work
