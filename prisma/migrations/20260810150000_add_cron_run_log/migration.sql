-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" JSONB,
    "error" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CronRun_path_startedAt_idx" ON "CronRun"("path", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "CronRun_startedAt_idx" ON "CronRun"("startedAt" DESC);
