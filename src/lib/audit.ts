import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function writeAuditLog(params: {
  superadminId: string;
  gymId?: string;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      superadminId: params.superadminId,
      gymId: params.gymId,
      action: params.action,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
