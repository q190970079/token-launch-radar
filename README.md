# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/q190970079/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/q190970079/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it prices every pre-token protocol in a sealed DefiLlama snapshot from the traded peer multiple of its own category, adjusted for TVL momentum, age with no token, and chain breadth, then ranks them into a board with a concrete, costed farm plan for each one and a filterable dashboard to read it on.

## How it works

- `main.ts` reads the snapshot, separates protocols that already trade a token (plus wrapped, staked, bridged and exchange products) from genuine launch candidates, and writes `board.json`, `data.js`, the dashboard and the dossier to the output directory.
- The board covers all 40 watchlist protocols and adds early finds below the $50M floor, 198 rows in this snapshot.
- The dashboard is static and offline: search, category and scope filters, four sort orders, and a per-protocol detail view with its farm steps.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. Node 22.18 or later, standard library only, no network. Two runs over the same snapshot write identical bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=k2f0jehz&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
