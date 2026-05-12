/*
  Warnings:

  - A unique constraint covering the columns `[email,chamaId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('MPESA', 'PAYSTACK', 'KCB', 'EQUITY');

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "chamaId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "chamaId" TEXT;

-- CreateTable
CREATE TABLE "Chama" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "logo" TEXT,
    "mpesaPaybill" TEXT,
    "mpesaPasskey" TEXT,
    "mpesaAccountRef" TEXT,
    "mpesaTransactionType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chama_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "name" TEXT,
    "config" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chamaId" TEXT NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAlert" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "checkoutRequestId" TEXT,
    "userId" TEXT,
    "provider" "IntegrationType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionAlert_externalId_key" ON "TransactionAlert"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionAlert_checkoutRequestId_key" ON "TransactionAlert"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_chamaId_key" ON "User"("email", "chamaId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_chamaId_fkey" FOREIGN KEY ("chamaId") REFERENCES "Chama"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_chamaId_fkey" FOREIGN KEY ("chamaId") REFERENCES "Chama"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_chamaId_fkey" FOREIGN KEY ("chamaId") REFERENCES "Chama"("id") ON DELETE SET NULL ON UPDATE CASCADE;
