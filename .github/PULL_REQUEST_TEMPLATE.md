## What this changes

<!-- One or two sentences. What a reader of the git log needs, not a diff summary. -->

## Why

<!-- The problem, or a link to the core issue / spec section this implements. -->

## Checks

- [ ] `npm run verify` passes
- [ ] `npm run format:check` passes
- [ ] New code has tests beside it, in `__tests__/`
- [ ] No handler, activity or pipeline code was copied from the core
      (AGENTS.md invariant 1) — a dependency or a core change instead
- [ ] If the deployment artifact changed, it still extends the published worker
      image rather than rebuilding it (invariant 2)
- [ ] If this depends on a new `@ragenai/jobs` version, the version range says so

## Core repository

<!-- Link the PR or spec section in webamigos/RagenAI this pairs with, or say "none". -->
