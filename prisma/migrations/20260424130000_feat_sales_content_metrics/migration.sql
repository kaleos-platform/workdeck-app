-- ─── Sales Content Deck (성과 지표) ────────────────────────────────────────

CREATE TYPE "MetricSource" AS ENUM ('MANUAL', 'API', 'BROWSER', 'INTERNAL');

CREATE TABLE "DeploymentMetric" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "externalClicks" INTEGER,
    "source" "MetricSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeploymentMetric_deploymentId_date_source_key"
    ON "DeploymentMetric"("deploymentId", "date", "source");
CREATE INDEX "DeploymentMetric_spaceId_date_idx" ON "DeploymentMetric"("spaceId", "date");
CREATE INDEX "DeploymentMetric_deploymentId_date_idx"
    ON "DeploymentMetric"("deploymentId", "date");

ALTER TABLE "DeploymentMetric"
    ADD CONSTRAINT "DeploymentMetric_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeploymentMetric"
    ADD CONSTRAINT "DeploymentMetric_deploymentId_fkey"
    FOREIGN KEY ("deploymentId") REFERENCES "ContentDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
