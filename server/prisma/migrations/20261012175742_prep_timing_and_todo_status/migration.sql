/*
  Warnings:

  - You are about to drop the column `isDone` on the `TodoItem` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PrepTiming" AS ENUM ('EXACT', 'SLOT');

-- CreateEnum
CREATE TYPE "TodoStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "PrepItem" ADD COLUMN     "timing" "PrepTiming" NOT NULL DEFAULT 'EXACT';

-- AlterTable
ALTER TABLE "TodoItem" DROP COLUMN "isDone",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "status" "TodoStatus" NOT NULL DEFAULT 'PENDING';
