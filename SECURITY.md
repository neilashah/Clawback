# Clawback Information Security Policy

**Effective:** November 10, 2026
**Owner:** Clawback Owner & Developer (the sole operator)
**Review:** at least once a year, and after any security incident or major change to the app

## 1. Purpose and scope

Clawback is a personal, non-commercial web app used by its owner and immediate family (fewer than 5 users). It reads credit card transactions (through SimpleFIN Bridge, or CSV files the user downloads from their card issuer) to detect when card statement credits have posted.

This policy covers the app's code (GitHub), hosting (Vercel), database and authentication (Supabase), bank-data connection (SimpleFIN Bridge), and the owner's accounts on those services.

## 2. Roles

- **Owner** (one person) is responsible for all security matters: access, secrets, monitoring, incident response, and this policy. Security contact: the owner's monitored email address.
- **Family users** can only sign in and use the app. They have no access to code, hosting, database, or vendor dashboards.

## 3. Data we handle

| Data | Where | Sensitivity |
|---|---|---|
| Email addresses of users | Supabase Auth | Personal |
| Card names, benefits, claim history | Supabase Postgres | Low |
| SimpleFIN access URL (contains credentials) | Supabase Postgres, **encrypted** | High |
| Card account names, transactions (date, amount, description) | Supabase Postgres | Personal financial |

Clawback does **not** store bank usernames or passwords (those are entered only on SimpleFIN's site), full card numbers, or account/routing numbers. It doesn't move money. Data is never sold or shared with third parties.

## 4. Security controls

### 4.1 Access control
- App sign-in is by email magic link only. Access is restricted to an allowlist (`ALLOWED_EMAILS`), and public sign-up is disabled in Supabase once family members have signed in.
- Every database table enforces row-level security, so each user can read and write only their own rows.
- Bank tables are written only by server-side code. Users can't read the encrypted access-URL column at all.
- Only the owner has accounts on GitHub, Vercel, Supabase, and SimpleFIN for this project.
- **Two-factor authentication is required** on the owner's GitHub, Vercel, Supabase, SimpleFIN, and primary email accounts.

### 4.2 Encryption
- All traffic uses HTTPS (TLS), provided by Vercel, Supabase, and SimpleFIN.
- The SimpleFIN access URL is encrypted at rest with AES-256-GCM using a key (`ENCRYPTION_KEY`) held only in Vercel's encrypted environment settings.
- The vendors encrypt their databases and storage at rest.

### 4.3 Secrets management
- Secrets (Supabase service-role key, encryption key, cron secret) live only in Vercel environment variables and the owner's password manager.
- Secrets are never committed to source code, shared in chat or email, or exposed to the browser.
- The SimpleFIN access URL is never logged; credentials are moved into an Authorization header at request time.

### 4.4 Application security
- The daily sync endpoint accepts only requests carrying the secret `CRON_SECRET` from Vercel Cron.
- SimpleFIN setup tokens are accepted only if they point to simplefin.org over HTTPS.
- Every server API route checks for a signed-in, allowlisted user before doing anything.
- Server code using the service-role key always filters by the signed-in user's ID.
- Changes go through GitHub pull requests. Type checks and unit tests run before merging.

### 4.5 Vendors
Clawback relies on Vercel (hosting), Supabase (database and auth), SimpleFIN Bridge (bank connectivity, via MX), and GitHub (code). Each publishes its own security and compliance programs. The owner uses only their standard services and reviews their security notices when received.

## 5. Monitoring

Monthly, the owner:
- Checks SimpleFIN Bridge for connection errors, unexpected app connections, and billing.
- Checks the Supabase Auth user list for unknown users.
- Checks Vercel for failed deployments or unexpected changes.
- Checks GitHub for security alerts (Dependabot) and applies dependency updates that fix vulnerabilities.

## 6. Incident response

If a secret may have leaked, or there's any unexpected access:
1. **Contain:** rotate the affected secret right away (new Supabase keys, new GitHub/Vercel credentials, new cron secret) and redeploy.
2. **Bank access:** if the SimpleFIN access URL or encryption key may be exposed, delete the app connection on simplefin.org (revoking it), remove it in Clawback, and reconnect with a new setup token.
3. **Users:** remove unknown users in Supabase and review the allowlist.
4. **Notify:** tell affected family users, and notify SimpleFIN if their credentials may be affected.
5. **Review:** record what happened and update this policy.

## 7. Data retention and deletion

- Removing the SimpleFIN connection in the app deletes its accounts and transactions; the owner also revokes it on simplefin.org.
- Deleting a user in Supabase deletes all of that user's data (cascading deletes).
- Data is kept only as long as the user keeps using the app. The owner deletes users who stop using it.

## 8. Policy review

The owner reviews this policy annually and after any incident or significant change. Revisions are tracked in this repository's git history.
