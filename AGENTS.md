# AGENTS.md

Guidance for coding agents working in this repository. This is the canonical
file — Claude Code, Codex, Cursor and Copilot all read `AGENTS.md`, and
`CLAUDE.md` is a one-line import of it so both names resolve to the same
content. Edit this file, never the pointer.

## What this repository is

Deployment-side extensions to [Ragen AI](https://github.com/webamigos/RagenAI),
which is the core and the place almost all work happens. Read the core's own
`AGENTS.md` first: its conventions apply here unless something below overrides
them.

One component is planned, and none is published yet:

| Component                | What it is                                                  | State                                         |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------- |
| `@ragenai/jobs-temporal` | The Temporal adapter behind the core's `@ragenai/jobs` seam | not written — arrives with the core's Phase E |

**The reason this repository exists** is that Ragen's default install runs the
worker on BullMQ, and the Temporal path costs every install that does not want
it two containers, a gRPC dependency and six `@temporalio/*` packages under a
version lock. The spec is
[`docs/specs/2026-09-15-bullmq-is-the-worker-runtime.md`](https://github.com/webamigos/RagenAI/blob/main/docs/specs/2026-09-15-bullmq-is-the-worker-runtime.md)
in the core. Read it before touching anything here; §8 of it is the contract
this repository has to honour.

## Commands

```bash
npm install                 # Node 24.x — `nvm use`
npm run verify              # typecheck + test + build across every workspace
npm run typecheck
npm run test
npm run format:check        # prettier; `npm run format` writes
```

There is no lint task yet, and that is deliberate rather than forgotten: the
core's shared config is `@ragenai/eslint-config`, a workspace package that is
not published. Adding ESLint here means either publishing that package or
duplicating its rules, and duplicating them is the thing the core's ADR-33
exists to prevent. Revisit when the first package lands.

## The five invariants

These are not style preferences. Each one is the reason a decision was taken in
the core, and breaking one turns this repository into the fork it was created
to avoid.

1. **No handler, no activity, no pipeline lives here.** The eight job handlers
   come from `@ragenai/jobs`; the 69 activity modules come from the published
   worker image. If you are about to copy either one into this repository, the
   answer is a dependency or a change in the core — see the core's
   [ADR-26](https://github.com/webamigos/RagenAI/blob/main/docs/adrs/26-absorb-ragen-worker-into-monorepo.md)
   and
   [ADR-33](https://github.com/webamigos/RagenAI/blob/main/docs/adrs/33-shared-platform-contracts-package.md),
   which are both records of the project paying to undo exactly that.
2. **The image extends, it does not rebuild.** The deployment artifact is
   `FROM` the OSS worker image plus this adapter. A Dockerfile here that
   installs the pipeline from source is the same mistake as (1) wearing a
   different hat.

   **That base image does not exist yet.** Nothing in the core publishes a
   Ragen image to a registry — self-hosting means building from source today —
   so publishing `ragen-worker` is a prerequisite for this repository's
   artifact, and it is half of the core spec's Q1. Do not work around it by
   building the pipeline here.

3. **The contract is a dependency, not a copy.** Job names, payload types and
   `JobContext` are `@ragenai/jobs`. A hand-synced copy of them here would be
   caught by no test in either repository — which is precisely why it must not
   exist.

   Where the package comes from is Q1 in the core spec, and the recommended
   answer is _not_ a registry: the worker image's
   `/app/node_modules/@ragenai/*` are symlinks into `/app/packages/`, so
   `@ragenai/jobs` already resolves inside the base image. The adapter then
   declares it as a peer dependency it never installs, and compiles against
   the exact contract the image ships rather than a version number that can
   skew from it.

4. **CI runs the real thing.** This repository runs the core's worker
   integration suite against a real Temporal container, against the current
   published handlers. A runtime that nothing exercises is not supported, it is
   abandoned with a package name. See
   [`.github/workflows/temporal-parity.yml`](.github/workflows/temporal-parity.yml).
5. **Drift is the thing being spent.** The core's
   [ADR-32](https://github.com/webamigos/RagenAI/blob/main/docs/adrs/32-token-vault-and-mcp-stay-separate.md)
   says to measure drift before putting anything in a sibling repository. The
   budget here is bounded by (1) and (2) — a thin layer over an image the core
   builds anyway. Anything that widens the layer needs that argument re-made,
   in an ADR, in the core.

## Conventions

Inherited from the core, and worth restating because they are enforced by
tooling here too:

- **Conventional commits**, enforced by commitlint. `feat:`, `fix:`, `chore:`,
  `docs:`, `refactor:`, `ci:`.
- **Branch model** — `main` is the trunk; topic branches named `feat/…`,
  `fix/…`, `chore/…`, `refactor/…`, `docs/…`. PRs target `main`.
- **ESM only.** `"type": "module"`; a CommonJS script gets a `.cjs`
  extension.
- **Braces required** on every `if`/`else`/`for`/`while` — no single-line
  bodies.
- **Tests beside the source**, in `__tests__/`. A thin adapter is still the
  only place its wiring exists, and it fails silently when it breaks: the core
  calls this out as the case most often left untested, and this repository is
  made almost entirely of that case.
- **Node 24.x** (Active LTS), pinned in `.nvmrc` and `engines`.

## Environment variables

**This repository defines none of its own, and documents none that the core
owns.** The generated configuration reference in
[`ragen-docs`](https://docs.ragen.ai) is the single source for variable names;
restating them here is how two documents start disagreeing about which one is
current. When a deployment note needs a variable, name it once and link to the
reference — see [`docs/cloud-providers.md`](docs/cloud-providers.md) for the
shape.

## Where to look

| Task                                                                       | Where                                                                                                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Anything about Ragen itself                                                | the core repository, and its `AGENTS.md`                                                                                               |
| Why the worker runs on BullMQ, and what Temporal is promised to keep doing | the core's [worker-runtime spec](https://github.com/webamigos/RagenAI/blob/main/docs/specs/2026-09-15-bullmq-is-the-worker-runtime.md) |
| Running the durable-execution runtime                                      | [`docs/durable-execution.md`](docs/durable-execution.md)                                                                               |
| Bedrock, Vertex AI or Azure OpenAI as the model provider                   | [`docs/cloud-providers.md`](docs/cloud-providers.md)                                                                                   |
| What is open and what is commercial                                        | the core's [open-core boundary](https://github.com/webamigos/RagenAI/blob/main/docs/open-core-boundary.md)                             |
| Reporting a vulnerability                                                  | [`SECURITY.md`](SECURITY.md)                                                                                                           |
