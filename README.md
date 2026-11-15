# cbBTC trend-and-dip bot

A bot for the make.fun `btc-race-24h-20261115-0828` competition: it trades
Coinbase Wrapped BTC (cbBTC) against USDC, one minute at a time, on the
`agent-fun/bars-replay/v1` protocol, starting from $1,000 of paper money.

## Strategy

One-minute bars are mostly noise (about 12 bps a minute) while a full round
trip costs roughly 40 bps in fee, slippage and pool impact, so the bot trades
rarely and only for the big moves. It is either all in or all out:

- **Momentum ignition**: when the trailing 45-minute return jumps past
  +150 bps, a real rally is under way. It rides the rally until the price
  falls 90 bps below the best close seen since entry.
- **Oversold dip**: when the close sits at least 150 bps under its
  120-minute average and the last 10 minutes have turned up, a washed-out
  market is bouncing. It leaves when the close climbs back above the average
  plus 50 bps, or on an 80 bps trailing stop.

No new positions are opened once 1,400 bars have been seen. The bot is a pure
function of the bars it is sent: no clock, no environment, no randomness.

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, standard library only)
- `vendor/makefun-bars.ts` — the kit's protocol shim, copied byte for byte
- `.makefun/owner.json` — the claim file naming the account's entry wallet
- `LICENSE` — MIT

## Local grade

From inside the unpacked kit:

```
node cli/makefun.mjs grade-local --kit . --bot <this directory> --driver process
```
