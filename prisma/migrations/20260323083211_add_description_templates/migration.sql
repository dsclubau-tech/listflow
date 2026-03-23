-- CreateTable
CREATE TABLE "DescriptionTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DescriptionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordBlacklist" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "removeFromTitle" BOOLEAN NOT NULL DEFAULT false,
    "removeFromDescription" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordBlacklist_pkey" PRIMARY KEY ("id")
);
