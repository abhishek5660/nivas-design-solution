# Deployment guide

The app is a standard Next.js server plus PostgreSQL. It needs: Node 20+, a PostgreSQL 14+ database, and two secrets set as **environment variables on the host** (never committed).

| Variable | Value |
|---|---|
| `DATABASE_URL` | connection string from your managed PostgreSQL (use the SSL / `?sslmode=require` form your provider gives you) |
| `SESSION_SECRET` | a fresh random string, 32+ characters: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| `FIRST_USER_IS_ADMIN` | optional, default `true` |

The production server refuses to create sessions if `SESSION_SECRET` is missing, shorter than 32 characters, or still contains the example text `change-me`.

## Commands every host needs

```bash
npm ci                    # postinstall runs `prisma generate`
npx prisma migrate deploy # creates tables (run once per release, before starting)
npm run build
npm start                 # listens on $PORT
```

## Option A - Render (long-running Node server; recommended)

1. Create a **PostgreSQL** instance, copy its *Internal Database URL*.
2. New **Web Service** from the GitHub repo. Build command: `npm ci && npx prisma migrate deploy && npm run build`. Start command: `npm start`.
3. Add the environment variables above. Deploy, open the URL, register the first account (becomes administrator).
4. Optionally turn off public sign-ups afterwards: Administration → Application → Open registration.

## Option B - Vercel + Neon / Supabase Postgres

1. Create the database and copy its DIRECT (non-pooled) connection string ending in `?sslmode=require` (migrations do not work through a pooler).
2. Import the repo in Vercel; add the environment variables; leave the Build Command override EMPTY (the `vercel-build` script in package.json runs the migration and the build).
3. Be aware of serverless limits: request bodies are capped at about 4.5 MB (the app allows 8 MB design saves and uploads, so very large designs/uploads can be rejected), and the login rate limiter is per instance.

## After deploying - smoke test

Register → create a Wardrobe, a Kitchen and a TV Panel project → open each in the editor → change a dimension → wait for "All changes saved" → reload the page → confirm the change persisted → open the BOQ and Production tabs → export a PDF.

*These host recipes are standard but were not executed from this repository; the build, type-check and unit tests were verified on a fresh clone.*
