-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'pronotool',
    "authorization" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "matchId" INTEGER NOT NULL,
    "homeTeam" TEXT,
    "awayTeam" TEXT,
    "phaseName" TEXT,
    "startTime" TEXT,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "shootoutWinner" INTEGER,
    "reasoning" TEXT NOT NULL DEFAULT '',
    "searchAnalysis" TEXT NOT NULL DEFAULT '',
    "model" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MigrationMeta" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'legacy',
    "legacyImportAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "predictionsImported" INTEGER NOT NULL DEFAULT 0,
    "authImported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Prediction_matchId_idx" ON "Prediction"("matchId");

-- CreateIndex
CREATE INDEX "Prediction_submittedAt_idx" ON "Prediction"("submittedAt");
