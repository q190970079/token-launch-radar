// Token Launch Radar — valuation model.
//
// Idea in one paragraph: a protocol that records no token yet is priced the
// way the market already prices its closest traded neighbours. For every
// category we take the traded protocols in the snapshot, work out the median
// ratio of market cap to TVL, and apply that multiple to a pre-token
// protocol's TVL. The raw peer price is then adjusted by three things the
// snapshot itself reports: seven-day TVL momentum, how long the protocol has
// been tracked while still recording no token, and how many chains it runs
// on. Everything is derived from the snapshot bytes, the snapshot's own
// as_of date is the only clock, and ties break on slug, so two runs over the
// same snapshot write byte-identical boards.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  peer_multiple: number;
  confidence: string;
  on_watchlist: boolean;
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  total_protocols: number;
  watchlist_size: number;
  live_size: number;
  early_size: number;
  board: BoardRow[];
  categories: string[];
}

const DAY_MS = 86_400_000;

export function loadSnapshot(raw: string): Snapshot {
  const parsed = JSON.parse(raw) as Snapshot;
  if (!Array.isArray(parsed.protocols) || !Array.isArray(parsed.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist arrays');
  }
  return parsed;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function wholeDaysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

/** Median market-cap / TVL multiple for traded protocols, per category. */
export function peerMultiples(snapshot: Snapshot): Map<string, number> {
  const ratiosByCategory = new Map<string, number[]>();
  const everyRatio: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    everyRatio.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const bucket = ratiosByCategory.get(key) ?? [];
    bucket.push(ratio);
    ratiosByCategory.set(key, bucket);
  }
  const globalMedian = everyRatio.length > 0 ? medianOf(everyRatio) : 1;
  const result = new Map<string, number>();
  for (const [key, bucket] of ratiosByCategory) {
    // Thin categories borrow strength from the whole market instead of
    // letting one small traded name set the price for a whole sector.
    result.set(key, bucket.length >= 3 ? medianOf(bucket) : (medianOf(bucket) + globalMedian) / 2);
  }
  result.set('*', globalMedian);
  return result;
}

export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

// Categories that are products of a token that already trades, or venues
// rather than protocols heading for a launch of their own. The watchlist
// rule in the snapshot's field guide excludes the same families, and the
// board applies that reasoning everywhere, not only above the floor: a
// wrapped bitcoin or an exchange's bridge is not a token still to come.
const NOT_A_LAUNCH = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isLaunchCandidate(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && NOT_A_LAUNCH.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

interface Scored {
  protocol: Protocol;
  implied: number;
  multiple: number;
  ageDays: number | null;
  confidence: string;
}

function scoreProtocol(p: Protocol, multiples: Map<string, number>, asOf: string): Scored {
  const rawMultiple = multiples.get(p.category ?? 'Uncategorised') ?? multiples.get('*') ?? 1;
  const multiple = clamp(rawMultiple, 0.12, 6);
  const ageDays = p.listed_at === null ? null : wholeDaysBetween(p.listed_at, asOf);

  // Momentum: a protocol gaining TVL this week is priced a little richer,
  // one bleeding TVL a little cheaper, never by more than the move itself.
  const momentum = p.change_7d === null ? 1 : 1 + clamp(p.change_7d, -35, 70) / 140;

  // Maturity: the longer a protocol has operated while still recording no
  // token, the more of its peer price it has earned. Brand-new listings get
  // a discovery discount instead of a free pass to the top of the board.
  const maturity = ageDays === null ? 0.82 : clamp(0.55 + ageDays / 900, 0.55, 1.12);

  // Breadth: each extra chain is distribution a launch can drop into.
  const breadth = 1 + Math.min(6, Math.max(0, p.chains.length - 1)) * 0.045;

  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth));
  const confidence =
    ageDays !== null && ageDays >= 540 && p.change_7d !== null
      ? 'high'
      : ageDays !== null && ageDays >= 180
        ? 'medium'
        : 'early';
  return { protocol: p, implied, multiple, ageDays, confidence };
}

function money(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd}`;
}

function budgetFor(tvl: number): { stake: string; gas: string; weeks: string } {
  if (tvl >= 500_000_000) return { stake: '$2,000-$5,000', gas: '$40-$90', weeks: '8-12 weeks' };
  if (tvl >= 100_000_000) return { stake: '$1,000-$2,500', gas: '$25-$60', weeks: '6-10 weeks' };
  if (tvl >= 25_000_000) return { stake: '$500-$1,200', gas: '$15-$40', weeks: '5-8 weeks' };
  return { stake: '$200-$600', gas: '$8-$25', weeks: '4-6 weeks' };
}

const CATEGORY_ACTIONS: Record<string, string> = {
  Dexs: 'swap against the deepest pools at least three times a week, then add two-sided liquidity to one mid-volume pair',
  Lending: 'supply a blue-chip asset, borrow a small amount against it, repay in full, and repeat the loop weekly',
  Derivatives: 'open small hedged perpetual positions, keep each one under 5% of your stake, and close them cleanly',
  Perps: 'open small hedged perpetual positions, keep each one under 5% of your stake, and close them cleanly',
  Yield: 'deposit into the flagship vault, let rewards accrue for two full epochs, and restake or rotate once',
  'Yield Aggregator': 'deposit into two different vault strategies so your activity is not a single repeated transaction',
  Bridge: 'route real transfers across two corridors instead of bridging back and forth on the same pair of chains',
  'Canonical Bridge': 'bridge funds in, use them on the destination chain for a week, and only then bridge anything back',
  'Liquid Staking': 'stake a modest amount, hold the liquid receipt token, and use that receipt in one partner protocol',
  'Staking Pool': 'stake a modest amount, stay staked through at least two reward epochs, and vote if governance is live',
  CDP: 'open a small collateralised position, mint against it conservatively, and repay before moving the collateral',
  RWA: 'complete onboarding early, hold an eligible real-world-asset position, and keep the holding through a full cycle',
  CEX: 'complete verification, trade spot in small size across several weeks, and keep a balance history on the venue',
  'Risk Curators': 'allocate to one curated vault, monitor its risk reports weekly, and rebalance only when the curator does',
  'Onchain Capital Allocator': 'allocate to one strategy vault, keep the position through a full reporting period, and track its updates',
  'Basis Trading': 'fund the basis vault with a small position and leave it untouched through at least one funding cycle',
};

/** Five concrete, costed farm steps, shaped by the protocol's own record. */
export function farmSteps(p: Protocol, onWatchlist: boolean): string[] {
  const plan = budgetFor(p.tvl_usd);
  const homeChain = p.chains[0] ?? 'its main chain';
  const action = CATEGORY_ACTIONS[p.category ?? ''] ??
    'use the protocol\u2019s core product the way a real user would, in small size, on a repeating weekly schedule';
  const multiChain = p.chains.length > 1
    ? `Repeat the same activity on ${p.chains[1]} in week three: multi-chain users cost about ${plan.gas} extra in bridge and gas fees, and sybil filters reward the spread.`
    : `Stay on ${homeChain} for the whole programme: splitting a small stake across chains you cannot fund properly only thins the record.`;
  const trend = p.change_7d === null
    ? 'TVL momentum is unreported for this protocol, so size it as an unknown: start at the bottom of the stake range.'
    : p.change_7d >= 0
      ? `TVL is up ${p.change_7d.toFixed(1)}% in seven days: momentum is on your side, but enter in two tranches a week apart rather than chasing one deposit.`
      : `TVL is down ${Math.abs(p.change_7d).toFixed(1)}% in seven days: halve the usual stake and re-check TVL before adding anything in week three.`;
  return [
    `Open a fresh wallet for ${p.name} and fund it on ${homeChain} with ${plan.stake} plus ${plan.gas} for gas; a dedicated wallet keeps this farm separable from your main accounts.`,
    `On ${homeChain}, ${action}. Budget ${plan.weeks} of steady use; one large deposit in a single day reads as airdrop farming, not usage.`,
    multiChain,
    `Keep a dated log of every transaction, fee and balance for ${p.name}; ${trend} Review the log every Sunday and stop if total fees pass 8% of stake.`,
    onWatchlist
      ? `This protocol sits on the radar watchlist with ${money(p.tvl_usd)} of TVL and still records no token: hold the position until a launch, snapshot or points programme is announced, then claim with the same wallet.`
      : `This is an early find below the $50M watchlist floor at ${money(p.tvl_usd)} of TVL: keep the position small, re-check its TVL monthly, and exit to stables if TVL halves or a token appears with no holder reward.`,
  ];
}

const BOARD_SIZE = 240;

export function rankProtocols(snapshot: Snapshot): Radar {
  const multiples = peerMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter(isLaunchCandidate);
  const scored = preToken
    .map((p) => scoreProtocol(p, multiples, snapshot.as_of))
    .sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1));

  // The watchlist is a floor: every watchlist protocol is on the board even
  // when the pure value cut would have left a smaller one just outside it.
  const chosen = new Map<string, Scored>();
  for (const entry of scored.slice(0, BOARD_SIZE)) chosen.set(entry.protocol.slug, entry);
  for (const entry of scored) {
    if (watch.has(entry.protocol.slug)) chosen.set(entry.protocol.slug, entry);
  }

  const ordered = [...chosen.values()].sort(
    (a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1),
  );
  const board: BoardRow[] = ordered.map((entry, index) => {
    const p = entry.protocol;
    return {
      slug: p.slug,
      name: p.name,
      rank: index + 1,
      implied_value_usd: entry.implied,
      farm_steps: farmSteps(p, watch.has(p.slug)),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: entry.ageDays,
      peer_multiple: Math.round(entry.multiple * 1000) / 1000,
      confidence: entry.confidence,
      on_watchlist: watch.has(p.slug),
    };
  });

  const categories = [...new Set(board.map((r) => r.category ?? 'Uncategorised'))].sort();
  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    total_protocols: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    live_size: snapshot.protocols.length - preToken.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    board,
    categories,
  };
}

/** Returns a short reason when a board breaks the gate's shape, else null. */
export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const validSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!validSlugs.has(row.slug)) return `row ${i + 1} names unknown slug ${row.slug}`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${row.slug} carries rank ${row.rank} at position ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has a non-positive or fractional implied value`;
    }
    if (row.implied_value_usd > previous) return `implied value rises again at rank ${row.rank}`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} carries ${row.farm_steps.length} farm steps, outside 3-12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `a farm step on ${row.slug} is ${len} characters, outside 20-600`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every row carries the same implied value, which ranks nothing';
  }
  return null;
}

/** The dashboard's data, as a script the static page loads beside itself. */
export function renderDataJs(radar: Radar): string {
  const payload = {
    as_of: radar.as_of,
    floor_usd: radar.floor_usd,
    total_protocols: radar.total_protocols,
    watchlist_size: radar.watchlist_size,
    live_size: radar.live_size,
    early_size: radar.early_size,
    categories: radar.categories,
    rows: radar.board,
  };
  return `window.RADAR_DATA = ${JSON.stringify(payload)};\n`;
}
