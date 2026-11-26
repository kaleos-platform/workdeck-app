-- CreateTable
CREATE TABLE "HiringCompanyProfile" (
    "spaceId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "intro" TEXT,
    "homepageUrl" TEXT,
    "blogUrl" TEXT,
    "instagramUrl" TEXT,
    "youtubeUrl" TEXT,
    "showIntro" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringCompanyProfile_pkey" PRIMARY KEY ("spaceId")
);

-- AddForeignKey
ALTER TABLE "HiringCompanyProfile" ADD CONSTRAINT "HiringCompanyProfile_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data API 잠금
ALTER TABLE "HiringCompanyProfile" ENABLE ROW LEVEL SECURITY;
