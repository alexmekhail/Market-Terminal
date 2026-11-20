import type { QuoteUpdate } from '@/types';

const WS_URL = 'wss://stream.data.alpaca.markets/v2/iex';

type Callback = (update: QuoteUpdate) => void;

class AlpacaSocketManager {
  private ws: WebSocket | null = null;
  private callbacks = new Map<string, Set<Callback>>();
  private prevClose = new Map<string, number>();
  private lastPrice = new Map<string, number>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isAuthenticated = false;
  private retries = 0;

  initialize() {
    if (typeof window === 'undefined' || this.reconnectTimer || this.ws) return;
    this.connect();
  }

  private connect() {
    const key = process.env.NEXT_PUBLIC_ALPACA_API_KEY;
    const secret = process.env.NEXT_PUBLIC_ALPACA_API_SECRET;
    if (!key || !secret) return;

    const socket = new WebSocket(WS_URL);
    this.ws = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ action: 'auth', key, secret }));
    };

    socket.onmessage = (event) => {
      try {
        const messages = JSON.parse(event.data as string);
        for (const msg of Array.isArray(messages) ? messages : [messages]) {
          this.handleMessage(msg);
        }
      } catch {}
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.isAuthenticated = false;
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private handleMessage(msg: Record<string, unknown>) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.T === 'success' && msg.msg === 'authenticated') {
      this.isAuthenticated = true;
      this.retries = 0;
      this.subscribeAll();
      return;
    }

    // Trade update
    if (msg.T === 't') {
      const ticker = msg.S;
      const price = msg.p;
      if (typeof ticker !== 'string' || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return;
      this.lastPrice.set(ticker, price);
      const update = this.quote(ticker, price);
      this.callbacks.get(ticker)?.forEach((callback) => callback(update));
    }
  }

  private quote(ticker: string, price: number): QuoteUpdate {
    const prevClose = this.prevClose.get(ticker) ?? price;
    const change = price - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;
    return { ticker, price, change, changePercent };
  }

  private subscribeAll() {
    const tickers = Array.from(this.callbacks.keys());
    if (tickers.length > 0) {
      this.ws!.send(JSON.stringify({ action: 'subscribe', trades: tickers }));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.callbacks.size === 0) return;
    const delay = Math.min(3000 * 2 ** this.retries, 30_000);
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.callbacks.size > 0) this.initialize();
    }, delay);
  }

  setPrevClose(ticker: string, prevClose: number) {
    this.prevClose.set(ticker, prevClose);
  }

  getCachedPrice(ticker: string): number | undefined {
    return this.lastPrice.get(ticker);
  }

  subscribe(ticker: string, callback: Callback) {
    const isNewTicker = !this.callbacks.has(ticker);
    if (isNewTicker) {
      this.callbacks.set(ticker, new Set());
    }
    this.callbacks.get(ticker)!.add(callback);

    // Emit cached value immediately so UI shows something on mount
    const cached = this.lastPrice.get(ticker);
    if (cached !== undefined) callback(this.quote(ticker, cached));

    if (this.isAuthenticated && this.ws?.readyState === WebSocket.OPEN) {
      if (isNewTicker) this.ws.send(JSON.stringify({ action: 'subscribe', trades: [ticker] }));
    } else {
      this.initialize();
    }
  }

  unsubscribe(ticker: string, callback: Callback) {
    const cbs = this.callbacks.get(ticker);
    if (!cbs) return;
    cbs.delete(callback);
    if (cbs.size === 0) {
      this.callbacks.delete(ticker);
      if (this.isAuthenticated && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'unsubscribe', trades: [ticker] }));
      }
    }
  }
}

// Singleton — safe to call from multiple components
export const alpacaSocket = new AlpacaSocketManager();
