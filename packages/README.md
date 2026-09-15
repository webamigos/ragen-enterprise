# packages/

One npm workspace per component. Empty for now.

| Planned         | What it is                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobs-temporal` | `@ragenai/jobs-temporal` — the Temporal adapter behind the core's `@ragenai/jobs` seam, plus the Dockerfile that layers it onto the published worker image |

Before adding one, read the five invariants in [`../AGENTS.md`](../AGENTS.md).
The first two decide most questions: no handler and no activity lives here, and
the image extends the core's rather than rebuilding it.
