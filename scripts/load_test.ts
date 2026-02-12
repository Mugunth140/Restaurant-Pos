#!/usr/bin/env bun
/**
 * scripts/load_test.ts
 *
 * Simple load test for the Meet & Eat POS API (POST /bills).
 *
 * Usage (with Bun):
 *   bun run scripts/load_test.ts --count 1000 --concurrency 10 --rate 200
 *
 * Options:
 *   --api <url>            API base URL (default: http://127.0.0.1:7777)
 *   --count, -n <num>      Number of bills to create (default: 1000)
 *   --concurrency, -c <n>  Number of concurrent workers (default: 10)
 *   --rate, -r <n>         Global maximum requests per second (optional)
 *   --min-items <n>        Minimum items per bill (default: 1)
 *   --max-items <n>        Maximum items per bill (default: 5)
 *   --min-price <cents>    Minimum unit price cents (default: 100)
 *   --max-price <cents>    Maximum unit price cents (default: 1500)
 *   --tax <bps>            Tax rate in basis points (default: 0)
 *   --progress <freq>      Print progress every <freq> completed bills (default: 100)
 *   --dry-run              Build payloads but don't send them (useful for validation)
 *   --seed <n>             Seed for deterministic randomness (optional)
 *
 * This tool is intentionally simple and portable (no external deps).
 */

type Opts = {
  api: string;
  count: number;
  concurrency: number;
  rate?: number;
  minItems: number;
  maxItems: number;
  minPrice: number;
  maxPrice: number;
  taxBps: number;
  progressFreq: number;
  dryRun: boolean;
  seed?: number;
};

function parseArgs(argv: string[]): Opts {
  const o: Partial<Opts> = {};
  const args = [...argv];
  while (args.length) {
    const a = args.shift()!;
    if (a === '--api') o.api = args.shift()!;
    else if (a === '--count' || a === '-n') o.count = Number(args.shift()!);
    else if (a === '--concurrency' || a === '-c') o.concurrency = Number(args.shift()!);
    else if (a === '--rate' || a === '-r') o.rate = Number(args.shift()!);
    else if (a === '--min-items') o.minItems = Number(args.shift()!);
    else if (a === '--max-items') o.maxItems = Number(args.shift()!);
    else if (a === '--min-price') o.minPrice = Number(args.shift()!);
    else if (a === '--max-price') o.maxPrice = Number(args.shift()!);
    else if (a === '--tax') o.taxBps = Number(args.shift()!);
    else if (a === '--progress') o.progressFreq = Number(args.shift()!);
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--seed') o.seed = Number(args.shift()!);
    else {
      // ignore unknown for now
    }
  }

  return {
    api: o.api ?? 'http://127.0.0.1:7777',
    count: Number(o.count ?? 1000),
    concurrency: Number(o.concurrency ?? 10),
    rate: o.rate,
    minItems: Number(o.minItems ?? 1),
    maxItems: Number(o.maxItems ?? 5),
    minPrice: Number(o.minPrice ?? 100),
    maxPrice: Number(o.maxPrice ?? 1500),
    taxBps: Number(o.taxBps ?? 0),
    progressFreq: Number(o.progressFreq ?? 100),
    dryRun: Boolean(o.dryRun ?? false),
    seed: o.seed,
  };
}

/** Simple RNG that can be seeded for reproducibility */
function makeRng(seed?: number) {
  if (typeof seed === 'number') {
    let s = seed >>> 0;
    return () => {
      // xorshift32
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967295;
    };
  }
  return Math.random;
}

function randInt(rng: () => number, min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rng = makeRng(opts.seed);

  console.log('Load test options:', {
    api: opts.api,
    count: opts.count,
    concurrency: opts.concurrency,
    rate: opts.rate,
    itemsRange: `${opts.minItems}-${opts.maxItems}`,
    priceRange: `${opts.minPrice}-${opts.maxPrice} cents`,
    tax_bps: opts.taxBps,
    dryRun: opts.dryRun,
  });

  // Global counters & state
  let nextIndex = 0;
  let successes = 0;
  let failures = 0;
  let totalLatency = 0;
  let aborted = false;

  // Rate limiting (global slot scheduler)
  let nextAvailable = Date.now();
  const perRequestMs = opts.rate ? Math.max(1, Math.floor(1000 / opts.rate)) : 0;
  async function waitForSlot() {
    if (!perRequestMs) return;
    while (true) {
      const now = Date.now();
      if (now >= nextAvailable) {
        nextAvailable = nextAvailable + perRequestMs;
        return;
      }
      const wait = Math.max(1, nextAvailable - now);
      await sleep(wait);
    }
  }

  // Graceful stop on Ctrl+C
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT — finishing in-flight requests and exiting...');
    aborted = true;
  });

  async function generateBillPayload() {
    const itemCount = randInt(rng, opts.minItems, opts.maxItems);
    const items = new Array(itemCount).fill(0).map(() => {
      const unit = randInt(rng, opts.minPrice, opts.maxPrice);
      const qty = randInt(rng, 1, 5);
      const pid = randInt(rng, 1, 1000);
      const name = `Item-${randInt(rng, 1, 100000)}`;
      return {
        product_id: pid,
        product_name: name,
        unit_price_cents: unit,
        qty,
        line_total_cents: unit * qty,
      };
    });
    return { items, tax_rate_bps: opts.taxBps };
  }

  async function sendOnce(i: number) {
    if (aborted) return;
    await waitForSlot();

    const payload = await generateBillPayload();
    if (opts.dryRun) {
      successes++;
      if ((i + 1) % opts.progressFreq === 0) {
        console.log(`dry-run: prepared ${i + 1}/${opts.count}`);
      }
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s
    const start = Date.now();
    try {
      const res = await fetch(`${opts.api}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const latency = Date.now() - start;
      totalLatency += latency;
      if (res.ok) {
        successes++;
      } else {
        failures++;
        const text = await res.text().catch(() => '<no body>');
        console.error(`failed ${i + 1}: status=${res.status} body=${text}`);
      }
    } catch (err: unknown) {
      failures++;
      if (err instanceof Error) {
        console.error(`error sending ${i + 1}: ${err.name} ${err.message}`);
      } else {
        console.error(`error sending ${i + 1}: ${String(err)}`);
      }
    } finally {
      clearTimeout(timeout);
      if ((i + 1) % opts.progressFreq === 0) {
        const done = successes + failures;
        console.log(
          `progress: ${done}/${opts.count} (success=${successes} fail=${failures})`,
        );
      }
    }
  }

  const t0 = Date.now();

  // Start worker pool
  const workers = new Array(opts.concurrency).fill(0).map(() =>
    (async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= opts.count) break;
        if (aborted) break;
        await sendOnce(i);
        // small jitter to avoid perfect coordination
        await sleep(randInt(rng, 0, 5));
      }
    })(),
  );

  await Promise.all(workers);

  const timeTaken = Date.now() - t0;
  console.log('\n--- Load test complete ---');
  console.log(`requested: ${opts.count}`);
  console.log(`completed: ${successes + failures}`);
  console.log(`successes: ${successes}`);
  console.log(`failures: ${failures}`);
  console.log(`time: ${timeTaken} ms`);
  console.log(`throughput: ${( (successes + failures) / (timeTaken / 1000) ).toFixed(2)} req/s`);
  console.log(`avg latency (successful reqs): ${successes ? (totalLatency / successes).toFixed(2) + ' ms' : 'n/a'}`);
  if (opts.rate) {
    console.log(`requested rate cap: ${opts.rate} req/s`);
  }
  if (aborted) {
    console.log('Note: run was aborted via SIGINT, some requests may not have been sent.');
  }
}

main().catch((err) => {
  console.error('Fatal error in load tester:', err);
  process.exit(1);
});
