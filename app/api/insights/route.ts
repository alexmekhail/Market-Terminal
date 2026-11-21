import { NextRequest, NextResponse } from 'next/server';

interface InsightRequest {
  ticker: string;
  price: number;
  changePercent: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
}

interface InsightResult {
  signal: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell';
  confidence: number;
  sentiment: 'Bullish' | 'Neutral' | 'Bearish';
  reasons: string[];
  summary: string;
}

const FALLBACK: InsightResult = {
  signal: 'Hold',
  confidence: 50,
  sentiment: 'Neutral',
  reasons: [
    'Insufficient data to generate analysis',
    'Please try again later',
    'Market conditions unclear',
    'No strong directional signals detected',
  ],
  summary: 'Unable to generate analysis at this time.',
};

// Per-process cache and concurrency guard. Instances do not share state.
const cache = new Map<string, { metrics: string; expiresAt: number; result: InsightResult }>();
const pending = new Set<string>();
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 256;
const MAX_PENDING = 8;
const MAX_PROVIDER_CALLS_PER_MINUTE = 60;
let budgetResetAt = 0;
let providerCalls = 0;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.:-]{0,15}$/;
const METRICS = ['price', 'changePercent', 'volume', 'open', 'high', 'low', 'prevClose'] as const;

function isInsightRequest(value: unknown): value is InsightRequest {
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return typeof fields.ticker === 'string'
    && TICKER_PATTERN.test(fields.ticker)
    && METRICS.every((key) => typeof fields[key] === 'number' && Number.isFinite(fields[key]));
}

function isInsightResult(value: unknown): value is InsightResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'].some((signal) => signal === result.signal)
    && ['Bullish', 'Neutral', 'Bearish'].some((sentiment) => sentiment === result.sentiment)
    && typeof result.confidence === 'number' && result.confidence >= 0 && result.confidence <= 100
    && Array.isArray(result.reasons) && result.reasons.length === 4
    && result.reasons.every((reason: unknown) => typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 80)
    && typeof result.summary === 'string' && result.summary.trim().length > 0 && result.summary.length <= 120;
}

const SYSTEM_PROMPT = `You are a quantitative stock analyst. Given stock metrics, produce a structured JSON analysis.
Return ONLY valid JSON, no preamble or markdown fences. Schema:
{
  "signal": "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell",
  "confidence": number (0-100),
  "sentiment": "Bullish" | "Neutral" | "Bearish",
  "reasons": string[] (exactly 4 items, each under 80 characters, specific and data-driven),
  "summary": string (one sentence, under 120 characters)
}`;

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isInsightRequest(payload)) {
    return NextResponse.json({ error: 'Valid ticker and finite stock metrics required' }, { status: 400 });
  }
  const body = payload;
  const { ticker } = body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(FALLBACK);
  }

  const metrics = JSON.stringify(METRICS.map((metric) => body[metric]));
  const cached = cache.get(ticker);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    if (cached.metrics === metrics) return NextResponse.json(cached.result);
    return NextResponse.json(
      { error: 'Analysis is cooling down. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((cached.expiresAt - now) / 1000)) } }
    );
  }
  if (pending.has(ticker) || pending.size >= MAX_PENDING) {
    return NextResponse.json(
      { error: 'Analysis is busy. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': '2' } }
    );
  }

  if (now >= budgetResetAt) {
    budgetResetAt = now + CACHE_TTL_MS;
    providerCalls = 0;
  }
  if (providerCalls >= MAX_PROVIDER_CALLS_PER_MINUTE) {
    return NextResponse.json(
      { error: 'Analysis quota reached. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((budgetResetAt - now) / 1000)) } }
    );
  }

  const intradayPosition =
    body.high !== body.low
      ? `${(((body.price - body.low) / (body.high - body.low)) * 100).toFixed(0)}% of intraday range`
      : 'flat intraday range';

  const priceVsOpen =
    body.open !== 0
      ? `${body.price >= body.open ? '+' : ''}${(((body.price - body.open) / body.open) * 100).toFixed(2)}% from open`
      : 'n/a';

  const userPrompt = `Analyze this stock and return JSON only:
Ticker: ${ticker}
Current Price: $${body.price}
Change Today: ${body.changePercent > 0 ? '+' : ''}${body.changePercent.toFixed(2)}%
Volume: ${body.volume.toLocaleString()}
Open: $${body.open}
Day High: $${body.high}
Day Low: $${body.low}
Previous Close: $${body.prevClose}
Price vs Open: ${priceVsOpen}
Intraday Range Position: ${intradayPosition}`;

  providerCalls += 1;
  pending.add(ticker);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      return NextResponse.json(FALLBACK);
    }

    const data = await res.json();
    const raw: unknown = data.content?.[0]?.text;
    if (typeof raw !== 'string') return NextResponse.json(FALLBACK);
    // Strip markdown code fences if model wraps response despite instructions
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    const result: unknown = JSON.parse(text);
    if (!isInsightResult(result)) return NextResponse.json(FALLBACK);

    cache.delete(ticker);
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(ticker, { metrics, expiresAt: Date.now() + CACHE_TTL_MS, result });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(FALLBACK);
  } finally {
    pending.delete(ticker);
  }
}
