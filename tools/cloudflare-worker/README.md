# Cloudflare Update-Check Telemetry

This folder contains the Worker and reporting tooling for CodexDNS update-check telemetry.

## What This Measures

The Worker in [update-check-telemetry.js](./update-check-telemetry.js) records update-check requests for:

- app version
- operating system
- architecture
- unique instance ID

The dataset name is `codexdns_update_checks`.

This measures installations that contact `docs.codexs.com.br/codexdns/version.json`. It is not a complete census of all deployments unless all deployments can reach that endpoint and have update checks enabled.

## Cloudflare Setup

1. Create a Workers Analytics Engine dataset named `codexdns_update_checks`.
2. Bind it to the Worker as `ANALYTICS`.
3. Deploy the Worker on the route `docs.codexs.com.br/*`.
4. Create a Cloudflare API token with permission:
   `Account | Account Analytics | Read`

Required values for the report script:

- `CF_ACCOUNT_ID`
- `CF_API_TOKEN`

You can store them in a local `.env` file at the docs repo root:

```bash
cp .env.example .env
```

Then fill in:

```bash
CF_ACCOUNT_ID=your_cloudflare_account_id
CF_API_TOKEN=your_cloudflare_account_analytics_read_token
```

`CF_ACCOUNT_ID` must be the Cloudflare **account ID**, which is a 32-character identifier. It is not your email address, login name, or zone name.

You can find it in the Cloudflare dashboard under the target account, usually in the right sidebar of the account overview pages.

The reporter loads `.env.local` first, then `.env`. Local environment variables still take precedence.

## Run Reports

From the `docs.codexs.com.br` repo:

```bash
CF_ACCOUNT_ID=<account-id> CF_API_TOKEN=<token> npm run cf:update-report
CF_ACCOUNT_ID=<account-id> CF_API_TOKEN=<token> npm run cf:update-report -- --days 90 --limit 100
CF_ACCOUNT_ID=<account-id> CF_API_TOKEN=<token> npm run cf:update-instances -- --days 30 --limit 200
CF_ACCOUNT_ID=<account-id> CF_API_TOKEN=<token> npm run cf:update-active
CF_ACCOUNT_ID=<account-id> CF_API_TOKEN=<token> npm run cf:update-tables
```

If you saved the credentials in `.env`, you can run the same commands without prefixing environment variables:

```bash
npm run cf:update-report
npm run cf:update-instances -- --days 30 --limit 200
npm run cf:update-active
```

## Report Modes

### Summary

Shows unique installations and total update checks grouped by version, OS, and architecture.

### Instances

Shows per-instance activity using the persisted CodexDNS instance ID, including first seen, last seen, and total checks.

### Active

Shows unique active installations for 24 hours, 7 days, and 30 days.

### Tables

Lists visible Analytics Engine datasets for the account, useful for verifying dataset setup.

## Notes

- The script queries the Cloudflare Workers Analytics Engine SQL API.
- Results can be sampled by Cloudflare at very high volume. The script uses `SUM(_sample_interval)` for total check counts.
- Unique instance counts are based on the update-check instance ID (`iid` / `index1`).
