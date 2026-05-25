-- CreateTable: 워커 프로세스 heartbeat (서비스별 마지막 ping 시각)
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "lastPingAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerHeartbeat_service_key" ON "WorkerHeartbeat"("service");
