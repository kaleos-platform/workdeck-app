#!/bin/bash
# AWS credential_process: 오프닝 S3 읽기 전용 IAM 키를 키체인에서 꺼내 JSON 으로 낸다(run.sh 전용 설정에서만 호출).
set -euo pipefail
g() { security find-generic-password -a workdeck -s "workdeck-opening-worker.$1" -w; }
PAIR=$(g s3-credentials); export PAIR
node -e '
  const { id, secret } = JSON.parse(process.env.PAIR)
  if (!id || !secret) process.exit(1)
  process.stdout.write(JSON.stringify({ Version: 1, AccessKeyId: id, SecretAccessKey: secret }))'
