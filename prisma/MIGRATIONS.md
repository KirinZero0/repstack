# Database migrations

The schema is managed with Prisma Migrate. `prisma/migrations/` is the source of truth for the
production database; `schema.prisma` describes the same thing for the client.

## Changing the schema

1. Edit `prisma/schema.prisma`.
2. Create the migration and read the SQL it wrote before applying it:

   ```bash
   npx prisma migrate dev --create-only --name what_changed
   npm run db:migrate:dev
   ```

3. If you added a table with a `gymId`, add its row-level-security policy (see `RLS.md`) and re-run
   `npm run db:rls`.
4. Commit the schema and the new migration folder together. Never edit a migration that has already been applied anywhere.

## Deploying

```bash
npm run db:migrate   # prisma migrate deploy: applies pending migrations, never resets anything
npm run db:rls       # idempotent; re-grants the app role on any new tables
```

Run these against the database **owner** connection (`DATABASE_URL`), before the new code goes live.
Prefer additive changes (new nullable columns, new tables) so the old and new code can both run during a deploy.

## A database that was created with `db push`

`0_init` is the baseline for the schema as it stood when migrations were introduced. If a database already has
that schema (created with `prisma db push`), tell Prisma so instead of replaying it:

```bash
npx prisma migrate resolve --applied 0_init
npm run db:migrate
```

A brand-new database just needs `npm run db:migrate`.

## Tests

The e2e setup runs `prisma migrate reset`, so the migrations themselves are exercised on every test run.
`db push` is no longer used.
