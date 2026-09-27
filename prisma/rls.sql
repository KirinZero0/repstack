-- Row-level security for Repstack. Applied by `npm run db:rls` (prisma/apply-rls.ts), which
-- fills in {{ROLE}} with the quoted application role. Safe to run repeatedly.
--
-- Model: the app connects two ways.
--   * the database owner (DATABASE_URL): not subject to RLS, used for auth, webhooks, cron, superadmin
--   * {{ROLE}} (APP_DATABASE_URL): subject to the policies below, used for every gym-scoped request
-- Before each query the app sets `app.current_gym_id` (see tenantDb in src/lib/prisma.ts). With no
-- setting the comparison is NULL and the role sees and writes nothing.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {{ROLE}};
GRANT USAGE ON SCHEMA public TO {{ROLE}};

-- The only tables gym-scoped code touches. Everything else (Superadmin, AuditLog, GymSignup,
-- MagicLink, PasswordReset, AppConfig) is deliberately not granted at all. MemberSignup holds the
-- manual join/bank-transfer requests staff review on /g/[slug]/members and act on via approve/reject.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Gym", "StaffUser", "MembershipPlan", "Member", "CheckIn", "Payment", "NotificationLog", "WhatsappSenderConfig", "PlatformPayment", "MemberSignup" TO {{ROLE}};
-- The plan catalog is not tenant data; gyms read their own plan's limits.
GRANT SELECT ON "SaasPlan" TO {{ROLE}};

ALTER TABLE "Gym" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Gym";
CREATE POLICY tenant_isolation ON "Gym" USING ("id" = current_setting('app.current_gym_id', true)) WITH CHECK ("id" = current_setting('app.current_gym_id', true));

ALTER TABLE "StaffUser" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StaffUser";
CREATE POLICY tenant_isolation ON "StaffUser" USING ("gymId" = current_setting('app.current_gym_id', true)) WITH CHECK ("gymId" = current_setting('app.current_gym_id', true));

ALTER TABLE "MembershipPlan" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MembershipPlan";
CREATE POLICY tenant_isolation ON "MembershipPlan" USING ("gymId" = current_setting('app.current_gym_id', true)) WITH CHECK ("gymId" = current_setting('app.current_gym_id', true));

ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Member";
CREATE POLICY tenant_isolation ON "Member" USING ("gymId" = current_setting('app.current_gym_id', true)) WITH CHECK ("gymId" = current_setting('app.current_gym_id', true));

ALTER TABLE "CheckIn" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CheckIn";
CREATE POLICY tenant_isolation ON "CheckIn" USING ("gymId" = current_setting('app.current_gym_id', true)) WITH CHECK ("gymId" = current_setting('app.current_gym_id', true));

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment" USING ("gymId" = current_setting('app.current_gym_id', true)) WITH CHECK ("gymId" = current_setting('app.current_gym_id', true));

ALTER TABLE "NotificationLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificationLog";
CREATE POLICY tenant_isolation ON "NotificationLog" USING ("gymId" = current_setting('app.current_gym_id', true)) WITH CHECK ("gymId" = current_setting('app.current_gym_id', true));

ALTER TABLE "WhatsappSenderConfig" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WhatsappSenderConfig";
CREATE POLICY tenant_isolation ON "WhatsappSenderConfig" USING ("gymId" = current_setting('app.current_gym_id', true)) WITH CHECK ("gymId" = current_setting('app.current_gym_id', true));

ALTER TABLE "PlatformPayment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PlatformPayment";
CREATE POLICY tenant_isolation ON "PlatformPayment" USING ("gymId" = current_setting('app.current_gym_id', true)) WITH CHECK ("gymId" = current_setting('app.current_gym_id', true));

ALTER TABLE "MemberSignup" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MemberSignup";
CREATE POLICY tenant_isolation ON "MemberSignup" USING ("gymId" = current_setting('app.current_gym_id', true)) WITH CHECK ("gymId" = current_setting('app.current_gym_id', true));
