## STAR - Latency cut on checkout API

**Situation:** Checkout p95 latency climbed to 900ms during a traffic spike.

**Task:** I owned bringing p95 under 300ms without a full rewrite.

**Action:** Profiled hot paths, added request coalescing for inventory reads, introduced a short TTL cache, and rolled out behind a feature flag with dashboards for error budget.

**Result:** p95 dropped to 240ms; checkout conversion recovered +2.1% week over week.

## STAR - Cross-team incident ownership

**Situation:** A schema migration from another team broke search ranking silently.

**Task:** Coordinate fix without blaming and restore ranking quality.

**Action:** Wrote a reproducible canary, proposed a dual-read window, and partnered with data eng on a backfill. Published a short RCA with prevention checks.

**Result:** Ranking restored in 6 hours; added migration lint that caught 3 similar issues the next quarter.
