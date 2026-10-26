-- AlterEnum: an owner can void a paid guest ticket (kept on record, not counted as revenue)
ALTER TYPE "GuestPassStatus" ADD VALUE 'VOIDED';
