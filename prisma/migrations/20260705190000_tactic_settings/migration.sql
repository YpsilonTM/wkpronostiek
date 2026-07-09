-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable
ALTER TABLE "Prediction" ADD COLUMN "tactic" TEXT;
ALTER TABLE "Prediction" ADD COLUMN "mirroredFromUserId" TEXT;
ALTER TABLE "Prediction" ADD COLUMN "mirroredFromRank" INTEGER;
