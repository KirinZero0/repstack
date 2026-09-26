/** Anything with a member.count, so both the system client and a gym's restricted client work. */
type MemberCounter = {
  member: { count(args: { where: { gymId: string; status: { not: "CANCELLED" } } }): Promise<number> };
};

/** Members that take up a seat on the gym's plan: everyone except cancelled (and erased) accounts. */
export function countMemberSeats(db: MemberCounter, gymId: string): Promise<number> {
  return db.member.count({ where: { gymId, status: { not: "CANCELLED" } } });
}

export function memberLimitMessage(planName: string, max: number): string {
  return `Your ${planName} plan allows ${max.toLocaleString("id-ID")} members. Upgrade your plan in Billing to add more.`;
}
