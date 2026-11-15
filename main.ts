// cbBTC trend-and-dip bot for the make.fun btc-race (agent-fun/bars-replay/v1).
//
// Idea: one-minute cbBTC bars are mostly noise (about 12 bps of wiggle a
// minute) while a full round trip costs roughly 40 bps in fee, slippage and
// pool impact, so the bot trades rarely and only for the big moves. It is
// either all in or all out, and it enters through one of two legs:
//
//   * momentum ignition: the trailing 45-minute return jumps past +150 bps,
//     so a real rally is under way rather than noise; it rides the rally
//     until the price falls 90 bps below the best close seen since entry.
//   * oversold dip: the close sits at least 150 bps under its 120-minute
//     average and the last 10 minutes have turned up, so a washed-out market
//     is bouncing; it leaves when the close climbs back above the average
//     plus 50 bps, or when it falls 80 bps below the best close since entry.
//
// No new entries once 1,400 bars have been seen, so a late position never
// pays a round trip for a few minutes of runway. Everything is a pure
// function of the bars: no clock, no environment, no randomness.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy knobs (basis points and bar counts).
const IGN_WINDOW = 45; // trailing return window for the ignition leg
const IGN_THRESH_BPS = 150n; // ignition fires past this trailing return
const IGN_TRAIL_BPS = 90n; // ignition leg exits this far below its peak close
const DIP_SMA = 120; // average the dip leg measures its discount against
const DIP_BPS = 150n; // dip leg enters this far below the average
const DIP_TURN_WINDOW = 10; // dip leg needs the last few minutes pointing up
const DIP_EXIT_BPS = 50n; // dip leg leaves above the average plus this
const DIP_TRAIL_BPS = 80n; // dip leg also exits this far below its peak close
const LAST_ENTRY_BAR = 1400; // stop opening new positions after this many bars
const MAX_SLIP_BPS = 500; // wide enough that a fast open never rejects a fill
const BPS = 10000n;

type Leg = 'ign' | 'dip' | null;

class Bot {
  private closes: bigint[] = [];
  private leg: Leg = null;
  private peak = 0n;

  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const bars = batch.bars.filter((b) => b.symbol === SYMBOL);
    if (bars.length === 0) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    this.closes.push(close);
    if (state.warmingUp) {
      // Warm-up bars build history but never take orders: any order decided
      // on one is rejected, so just record the close.
      return [];
    }
    const held = state.positions.get(SYMBOL);
    const qty = held === undefined ? 0n : held.qty;
    if (qty > 0n) return this.maybeExit(close, qty);
    return this.maybeEnter(state, close);
  }

  private maybeExit(close: bigint, qty: bigint): OrderInput[] {
    if (close > this.peak) this.peak = close;
    const trail = this.leg === 'ign' ? IGN_TRAIL_BPS : DIP_TRAIL_BPS;
    if (((this.peak - close) * BPS) / this.peak >= trail) {
      this.leg = null;
      return [this.sell(qty)];
    }
    if (this.leg === 'dip' && this.closes.length >= DIP_SMA) {
      const avg = this.average(DIP_SMA);
      if ((close * BPS) / avg >= BPS + DIP_EXIT_BPS) {
        this.leg = null;
        return [this.sell(qty)];
      }
    }
    return [];
  }

  private maybeEnter(state: BarsState, close: bigint): OrderInput[] {
    if (this.closes.length >= LAST_ENTRY_BAR) return [];
    if (this.closes.length > IGN_WINDOW) {
      const base = this.closes[this.closes.length - IGN_WINDOW - 1]!;
      if (((close - base) * BPS) / base >= IGN_THRESH_BPS) {
        this.leg = 'ign';
        this.peak = close;
        return [this.buy(state.cash)];
      }
    }
    if (this.closes.length >= DIP_SMA + DIP_TURN_WINDOW) {
      const avg = this.average(DIP_SMA);
      const discount = ((avg - close) * BPS) / avg;
      const back = this.closes[this.closes.length - DIP_TURN_WINDOW - 1]!;
      const turn = ((close - back) * BPS) / back;
      if (discount >= DIP_BPS && turn > 0n) {
        this.leg = 'dip';
        this.peak = close;
        return [this.buy(state.cash)];
      }
    }
    return [];
  }

  private average(n: number): bigint {
    let sum = 0n;
    for (let i = this.closes.length - n; i < this.closes.length; i++) sum += this.closes[i]!;
    return sum / BigInt(n);
  }

  private buy(notional: bigint): OrderInput {
    return { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIP_BPS };
  }

  private sell(qty: bigint): OrderInput {
    return { side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIP_BPS };
  }
}

const bot = new Bot();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
