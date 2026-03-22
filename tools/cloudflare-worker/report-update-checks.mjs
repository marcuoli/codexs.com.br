#!/usr/bin/env node

import fs from 'node:fs';

const DEFAULT_DATASET = 'codexdns_update_checks';
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 50;

function loadEnvFile() {
  const cwd = process.cwd();
  const candidates = [
    `${cwd}/.env.local`,
    `${cwd}/.env`,
  ];

  for (const file of candidates) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const eq = line.indexOf('=');
      if (eq <= 0) {
        continue;
      }

      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }

    return file;
  }

  return null;
}

function printHelp() {
  console.log(`CodexDNS Cloudflare update-check telemetry reporter

Usage:
  node tools/cloudflare-worker/report-update-checks.mjs <mode> [options]

Modes:
  summary     Show unique instances and total checks by version/os/arch
  instances   Show per-instance activity with first_seen/last_seen
  active      Show active unique instances for 24h, 7d, and 30d
  tables      List Analytics Engine datasets visible to the account

Options:
  --days <n>       Time window in days for summary/instances (default: ${DEFAULT_DAYS})
  --limit <n>      Row limit for summary/instances (default: ${DEFAULT_LIMIT})
  --dataset <name> Analytics Engine dataset name (default: ${DEFAULT_DATASET})
  --json           Print raw JSON rows instead of a table
  --help           Show this help

Required environment variables:
  CF_ACCOUNT_ID    Cloudflare account ID
  CF_API_TOKEN     API token with Account Analytics Read permission

Examples:
  npm run cf:update-report
  npm run cf:update-report -- --days 90 --limit 100
  npm run cf:update-instances -- --days 30 --limit 200
  npm run cf:update-active
`);
}

function parseArgs(argv) {
  const parsed = {
    mode: 'summary',
    days: DEFAULT_DAYS,
    limit: DEFAULT_LIMIT,
    dataset: DEFAULT_DATASET,
    json: false,
  };

  const args = [...argv];
  if (args.length > 0 && !args[0].startsWith('-')) {
    parsed.mode = args.shift();
  }

  while (args.length > 0) {
    const arg = args.shift();
    switch (arg) {
      case '--days':
        parsed.days = Number(args.shift());
        break;
      case '--limit':
        parsed.limit = Number(args.shift());
        break;
      case '--dataset':
        parsed.dataset = args.shift() ?? parsed.dataset;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(parsed.days) || parsed.days <= 0) {
    throw new Error('--days must be a positive number');
  }
  if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) {
    throw new Error('--limit must be a positive number');
  }

  return parsed;
}

function getQuery({ mode, days, limit, dataset }) {
  switch (mode) {
    case 'summary':
      return `
SELECT
  blob1 AS version,
  blob2 AS os,
  blob3 AS arch,
  COUNT(DISTINCT index1) AS unique_instances,
  SUM(_sample_interval) AS total_checks
FROM ${dataset}
WHERE timestamp > NOW() - INTERVAL '${days}' DAY
GROUP BY version, os, arch
ORDER BY unique_instances DESC, total_checks DESC
LIMIT ${limit}
FORMAT JSON
`.trim();
    case 'instances':
      return `
SELECT
  index1 AS instance_id,
  blob1 AS version,
  blob2 AS os,
  blob3 AS arch,
  MIN(timestamp) AS first_seen,
  MAX(timestamp) AS last_seen,
  SUM(_sample_interval) AS total_checks
FROM ${dataset}
WHERE timestamp > NOW() - INTERVAL '${days}' DAY
GROUP BY instance_id, version, os, arch
ORDER BY last_seen DESC
LIMIT ${limit}
FORMAT JSON
`.trim();
    case 'active':
      throw new Error('active mode uses per-window queries and should not call getQuery()');
    case 'tables':
      return 'SHOW TABLES FORMAT JSON';
    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}

function getActiveWindowQueries(dataset) {
  return [
    {
      period: '24h',
      query: `SELECT COUNT(DISTINCT index1) AS active_instances FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '24' HOUR FORMAT JSON`,
    },
    {
      period: '7d',
      query: `SELECT COUNT(DISTINCT index1) AS active_instances FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '7' DAY FORMAT JSON`,
    },
    {
      period: '30d',
      query: `SELECT COUNT(DISTINCT index1) AS active_instances FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '30' DAY FORMAT JSON`,
    },
  ];
}

async function runQuery(accountId, apiToken, query) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'text/plain',
      },
      body: query,
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Cloudflare API error ${response.status}: ${text}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Unexpected non-JSON response: ${text}`);
  }

  if (parsed.success === false) {
    throw new Error(`Cloudflare API returned success=false: ${JSON.stringify(parsed.errors ?? parsed)}`);
  }

  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  if (Array.isArray(parsed.result)) {
    return parsed.result;
  }
  if (Array.isArray(parsed.rows)) {
    return parsed.rows;
  }
  return [];
}

async function runActiveQueries(accountId, apiToken, dataset) {
  const windows = getActiveWindowQueries(dataset);
  const rows = [];

  for (const window of windows) {
    const result = await runQuery(accountId, apiToken, window.query);
    rows.push({
      period: window.period,
      active_instances: result[0]?.active_instances ?? 0,
    });
  }

  return rows;
}

function formatTable(rows) {
  if (!rows.length) {
    return 'No rows returned.';
  }

  const headers = Object.keys(rows[0]);
  const widths = headers.map((header) => header.length);

  for (const row of rows) {
    headers.forEach((header, index) => {
      const value = row[header] == null ? '' : String(row[header]);
      widths[index] = Math.max(widths[index], value.length);
    });
  }

  const renderLine = (values) => values.map((value, index) => String(value).padEnd(widths[index])).join('  ');
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');

  return [renderLine(headers), divider, ...rows.map((row) => renderLine(headers.map((header) => row[header] ?? '')))].join('\n');
}

function validateConfig(accountId, apiToken) {
  if (!accountId || !apiToken) {
    throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN must be set');
  }

  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error(
      'CF_ACCOUNT_ID must be the 32-character Cloudflare account ID, not your email, username, or zone name.'
    );
  }
}

async function main() {
  loadEnvFile();

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  validateConfig(accountId, apiToken);

  const rows = options.mode === 'active'
    ? await runActiveQueries(accountId, apiToken, options.dataset)
    : await runQuery(accountId, apiToken, getQuery(options));

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log(`Dataset: ${options.dataset}`);
  if (options.mode === 'summary' || options.mode === 'instances') {
    console.log(`Window : last ${options.days} day(s)`);
  }
  console.log(`Mode   : ${options.mode}`);
  console.log('');
  console.log(formatTable(rows));
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
