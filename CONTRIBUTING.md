# Contributing

Almost all Ragen work happens in the [core
repository](https://github.com/webamigos/RagenAI). This one holds
deployment-side extensions, and a change here is usually the smaller half of a
change there.

## Before you start

- **Is it a change to Ragen itself?** It belongs in the core. If a deployment
  cannot work without it, it is core by definition.
- **Is it a copy of something in the core?** Then it is the wrong change — see
  the five invariants in [AGENTS.md](AGENTS.md). Take a dependency, or change
  the core.
- **Security vulnerabilities** — do not open an issue. See
  [SECURITY.md](SECURITY.md).

## Branch model

- `main` is the trunk. Base your work there and target it in pull requests.
- Topic branches: `feat/…`, `fix/…`, `chore/…`, `refactor/…`, `docs/…`.
- **Conventional commits**, enforced by commitlint.

## Before you open a pull request

```bash
npm run verify        # typecheck + test + build
npm run format:check
```

New code comes with tests. This repository is made almost entirely of thin
adapters, which is the category the core's `AGENTS.md` singles out as the one
most often left untested — a five-line file that injects a client is still the
only place that wiring exists, and it fails silently when it breaks.

## Licence of contributions

This repository is [Apache 2.0](LICENSE) and contributions are accepted under
the same terms. If a directory ever carries its own `LICENSE` file, that file
governs it and contributions to that directory cannot be accepted — the core's
[open-core boundary](https://github.com/webamigos/RagenAI/blob/main/docs/open-core-boundary.md)
explains why. No such directory exists today.
