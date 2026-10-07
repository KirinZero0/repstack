import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMemberAttendance } from "@/lib/stats";
import { findOpenCheckIn, getGymBoardForMember, whoIsInEnabled } from "@/lib/occupancy";
import { dayKeyInTimezone } from "@/lib/date";
import { checkinRules } from "@/lib/checkin";
import { getLeaderboard, rankOf } from "@/lib/leaderboard";
import CheckOutButton from "./CheckOutButton";
import GymBoardToggle from "./GymBoardToggle";
import { BarChart, Card, Heatmap, StatCard, StatusPill, rp } from "@/components/charts";
import MemberLogout from "./MemberLogout";
import DeleteAccount from "./DeleteAccount";
import MockCheckout from "./MockCheckout";
import { isMockMode } from "@/lib/xendit";

export const dynamic = "force-dynamic";

export default async function MemberDashboardPage({ searchParams }: { searchParams: { "mock-invoice"?: string } }) {
  const session = await getSession();

  if (!session || session.kind !== "member") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <div className="text-center">
          <p className="mb-4 text-neutral-300">Log in as a member to see your dashboard.</p>
          <a href="/" className="text-sm text-neutral-500 hover:text-neutral-300">← Back home</a>
        </div>
      </main>
    );
  }

  const db = tenantDb(session.gymId);
  const member = await db.member.findUnique({
    where: { id: session.memberId },
    include: { plan: true, gym: true },
  });
  if (!member || member.gymId !== session.gymId || member.anonymizedAt) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">Account not found.</p>
      </main>
    );
  }

  const showWhoIsIn = whoIsInEnabled(member.gym.settings);
  const [att, payments, openCheckIn, pendingRenewal, board, lastCheckIns, gymBoard] = await Promise.all([
    getMemberAttendance(db, member.id, member.gym.timezone),
    db.payment.findMany({
      where: { memberId: member.id, gymId: member.gymId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { plan: { select: { name: true } } },
    }),
    findOpenCheckIn(db, member.gymId, member.id, member.gym.settings),
    db.memberSignup.findFirst({ where: { gymId: member.gymId, memberId: member.id, kind: "RENEWAL", status: "PENDING_REVIEW" } }),
    getLeaderboard(db, member.gymId, member.gym.timezone),
    db.checkIn.findMany({ where: { gymId: member.gymId, memberId: member.id, result: "SUCCESS" }, orderBy: { checkedInAt: "desc" }, take: 12 }),
    showWhoIsIn ? getGymBoardForMember(db, member.gymId, member.gym.settings, member.id) : Promise.resolve(null),
  ]);
  const timeLabel = (d: Date) => d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: member.gym.timezone });
  // The gym allows N check-ins per calendar day in its own timezone; the button turns yellow once they're used up.
  const rules = checkinRules(member.gym.settings);
  const todayKey = dayKeyInTimezone(new Date(), member.gym.timezone);
  const todaysCheckIns = lastCheckIns.filter((c) => dayKeyInTimezone(c.checkedInAt, member.gym.timezone) === todayKey);
  const lastCheckIn = lastCheckIns[0] ?? null;
  const checkedInToday = todaysCheckIns.length >= rules.perDay;

  const mockId = isMockMode() ? searchParams["mock-invoice"] : undefined;
  const mockPayment = mockId
    ? await db.payment.findFirst({ where: { id: mockId, memberId: member.id, status: "PENDING" }, include: { plan: true } })
    : null;
  // The mock "hosted page" for a class seat lands here too; it goes back to the classes page afterwards.
  const mockClassPayment =
    mockId && !mockPayment
      ? await db.classPayment.findFirst({
          where: { id: mockId, status: "PENDING", registration: { memberId: member.id } },
          include: { registration: { include: { session: { include: { class: true } } } } },
        })
      : null;

  const daysLeft = member.membershipExpiry
    ? Math.ceil((member.membershipExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
  const needsPayment = !(member.status === "ACTIVE" && daysLeft !== null && daysLeft >= 0);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Hi, {member.fullName.split(" ")[0]}</h1>
            <p className="text-sm text-neutral-400">{member.gym.name}</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/my/classes" className="text-neutral-300 hover:text-white">Classes</a>
            <a href="/my-qr" className="text-neutral-300 hover:text-white">My QR</a>
            <MemberLogout slug={member.gym.slug} />
          </nav>
        </div>

        {mockPayment && (
          <MockCheckout paymentId={mockPayment.id} amount={rp(Number(mockPayment.amount))} planName={mockPayment.plan.name} />
        )}
        {mockClassPayment && (
          <MockCheckout
            paymentId={mockClassPayment.id}
            amount={rp(Number(mockClassPayment.amount))}
            planName={`${mockClassPayment.registration.session.class.name} class`}
            returnTo="/my/classes"
          />
        )}

        {checkedInToday ? (
          <div
            role="status"
            className="mb-3 flex items-center justify-between gap-4 rounded-2xl bg-plate-yellow px-6 py-6 text-[#17130a] shadow-[0_12px_40px_-8px_rgba(232,185,35,0.55)] sm:py-7"
          >
            <span>
              <span className="block font-display text-2xl font-semibold sm:text-3xl">You already checked in</span>
              <span className="mt-1 block text-sm text-[#17130a]/80">
                {lastCheckIn ? `Checked in at ${timeLabel(lastCheckIn.checkedInAt)}. ` : ""}
                {rules.perDay > 1 ? `That's all ${rules.perDay} for today. ` : ""}See you tomorrow.
              </span>
            </span>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l2.7 2.7L16 9.5" />
            </svg>
          </div>
        ) : (
          <a
            href="/check-in"
            className="group mb-3 flex items-center justify-between gap-4 rounded-2xl bg-plate-green px-6 py-6 text-[#ffffff] shadow-[0_12px_40px_-8px_rgba(46,158,91,0.65)] transition hover:brightness-110 active:scale-[0.99] sm:py-7"
          >
            <span>
              <span className="block font-display text-2xl font-semibold sm:text-3xl">Check in</span>
              <span className="mt-1 block text-sm text-[#ffffff]/85">
                {todaysCheckIns.length > 0 ? `Scan the code at the gym entrance. Check-in ${todaysCheckIns.length} of ${rules.perDay} used today.` : "Scan the code at the gym entrance"}
              </span>
            </span>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
              <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
              <path d="M8 12h8" />
            </svg>
          </a>
        )}
        {openCheckIn && (
          <CheckOutButton sinceLabel={openCheckIn.checkedInAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: member.gym.timezone })} />
        )}
        {member.status === "FROZEN" ? (
          <p className="mb-6 text-sm text-amber-400">Your membership is frozen, so check-in is paused. Ask the front desk to unfreeze it.</p>
        ) : member.status === "CANCELLED" ? (
          <p className="mb-6 text-sm text-amber-400">Your membership was cancelled, so check-in will be declined. Ask the front desk to reactivate it.</p>
        ) : needsPayment ? (
          <p className="mb-6 text-sm text-amber-400">Your membership isn&apos;t active, so check-in will be declined until you renew.</p>
        ) : (
          <div className="mb-6" />
        )}

        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div>
            <p className="text-sm text-neutral-400">{member.plan.name} membership</p>
            <div className="mt-1 flex items-center gap-3">
              <StatusPill status={member.status} />
              <span className={`text-sm ${expiringSoon ? "text-amber-400" : "text-neutral-300"}`}>
                {member.membershipExpiry
                  ? daysLeft !== null && daysLeft >= 0
                    ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left · expires ${member.membershipExpiry.toLocaleDateString("id-ID")}`
                    : `expired ${member.membershipExpiry.toLocaleDateString("id-ID")}`
                  : "no active period"}
              </span>
            </div>
          </div>
          <a
            href="/my/pay"
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              needsPayment || expiringSoon
                ? "bg-white text-neutral-950 hover:bg-neutral-200"
                : "border border-neutral-700 text-white hover:bg-neutral-800"
            }`}
          >
            {pendingRenewal ? "Renewal pending" : needsPayment ? "Pay for membership" : "Renew"}
          </a>
        </div>
        {pendingRenewal && (
          <p className="-mt-4 mb-6 text-sm text-amber-400">Your renewal request is with the gym. Your membership extends as soon as they confirm the transfer.</p>
        )}

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Visits this month" value={String(att.thisMonth)} />
          <StatCard label="Current streak" value={`${att.streak} day${att.streak === 1 ? "" : "s"}`} />
          <StatCard label="Total visits" value={String(att.total)} />
          <StatCard label="Last visit" value={att.last ? att.last.toLocaleDateString("id-ID") : "—"} />
        </div>

        <div className="mb-6 grid gap-6 sm:grid-cols-2">
          <Card title="Last 12 weeks">
            <Heatmap data={att.heat} />
            <p className="mt-3 text-xs text-neutral-500">Each square is a day; green = you visited.</p>
          </Card>
          <Card title="Visits per week">
            <BarChart data={att.weekly} />
          </Card>
        </div>

        {gymBoard && (
          <div className="mb-6">
            <Card title="Who's in the gym">
              <p className="mb-3 text-sm text-neutral-300">
                <span className="font-display text-2xl font-semibold tabular-nums">{gymBoard.total}</span>{" "}
                <span className="text-neutral-400">{gymBoard.total === 1 ? "person is" : "people are"} training right now</span>
              </p>
              {gymBoard.others.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  {gymBoard.total === 0 ? "Nobody yet. Be the first." : "Nobody else you can see right now."}
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {gymBoard.others.map((o) => (
                    <li key={o.memberId} className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-950 py-1 pl-1 pr-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-plate-green text-xs font-semibold text-[#ffffff]">{o.name[0]}</span>
                      <span>{o.name}</span>
                      <span className="text-xs text-neutral-500">since {timeLabel(o.since)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <GymBoardToggle hidden={member.hideFromGymBoard} />
            </Card>
          </div>
        )}

        {board && (
          <div className="mb-6 grid gap-6 sm:grid-cols-2">
            <Card title="Leaderboard · visits this month">
              <Board rows={board.visits} me={member.id} unit="visits" />
              {rankOf(board.visits, member.id) !== null && (
                <p className="mt-3 text-xs text-neutral-500">You&apos;re #{rankOf(board.visits, member.id)} of {board.visits.length}.</p>
              )}
            </Card>
            <Card title="Leaderboard · current streaks">
              <Board rows={board.streaks} me={member.id} unit="days" />
              {rankOf(board.streaks, member.id) !== null && (
                <p className="mt-3 text-xs text-neutral-500">You&apos;re #{rankOf(board.streaks, member.id)} of {board.streaks.length}.</p>
              )}
            </Card>
          </div>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          <Card title="Recent visits">
            {att.recent.length === 0 ? (
              <p className="text-sm text-neutral-500">No visits yet — go lift something.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {att.recent.map((d, i) => (
                  <li key={i} className="flex justify-between border-b border-neutral-800 pb-2 last:border-0">
                    <span>{d.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" })}</span>
                    <span className="text-neutral-500">
                      {d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: member.gym.timezone })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Payments">
            {payments.length === 0 ? (
              <p className="text-sm text-neutral-500">No payments yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between border-b border-neutral-800 pb-2 last:border-0">
                    <span>
                      {p.plan.name}
                      <span className="ml-2 text-neutral-500">{p.createdAt.toLocaleDateString("id-ID")}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {rp(Number(p.amount))} <StatusPill status={p.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="mt-10 border-t border-neutral-800 pt-6">
          <DeleteAccount />
        </div>
      </div>
    </main>
  );
}

function Board({ rows, me, unit }: { rows: { memberId: string; name: string; value: number }[]; me: string; unit: string }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">Nobody on the board yet. Be the first.</p>;
  return (
    <ol className="space-y-1 text-sm">
      {rows.slice(0, 10).map((r, i) => (
        <li key={r.memberId} className={`flex items-center justify-between rounded-md px-2 py-1 ${r.memberId === me ? "bg-neutral-800 font-medium" : ""}`}>
          <span>
            <span className="mr-3 inline-block w-5 text-right tabular-nums text-neutral-500">{i + 1}</span>
            {r.name}
            {r.memberId === me && <span className="ml-2 text-xs text-neutral-400">you</span>}
          </span>
          <span className="tabular-nums text-neutral-300">{`${r.value} ${unit}`}</span>
        </li>
      ))}
    </ol>
  );
}
