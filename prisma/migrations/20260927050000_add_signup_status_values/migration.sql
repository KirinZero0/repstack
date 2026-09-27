-- AlterEnum
-- New enum values must land in their own migration, committed before anything uses them
-- (a manual bank-transfer request awaiting or failing staff review).
ALTER TYPE "SignupStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "SignupStatus" ADD VALUE 'REJECTED';
