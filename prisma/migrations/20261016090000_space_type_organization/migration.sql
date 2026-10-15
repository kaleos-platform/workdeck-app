-- 팀원 초대를 쓰는 기존 Space 2개를 ORGANIZATION 으로 전환한다(PERSONAL Space 는 초대·구성원 추가를 거부).
UPDATE "Space" SET "type" = 'ORGANIZATION'
WHERE "id" IN ('78377ae5-6614-4a40-9998-d0c392f9083b', 'cmv0yy4cr000b06jsp7f5zk7h')
  AND "type" = 'PERSONAL';
