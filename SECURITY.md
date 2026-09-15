# Security Policy

This repository holds deployment-side extensions to Ragen AI. The core's policy
applies here unchanged, including the response timelines.

## Reporting a vulnerability

**Do not open a public issue.** Report privately to **security@webamigos.pl**,
or through GitHub's [private vulnerability
reporting](https://github.com/webamigos/ragen-enterprise/security/advisories/new).

Include what you have — a partial report is better than none:

- what the vulnerability is, and which component it affects
- steps to reproduce, or a proof of concept
- the impact you think it has, and who it affects
- a suggested fix, if you have one

## What to expect

| Step                                           | Timeline |
| ---------------------------------------------- | -------- |
| Acknowledgement that we received your report   | 48 hours |
| Initial assessment and severity classification | 7 days   |
| A fix timeline communicated back to you        | 14 days  |

## Scope

In scope: the components published from this repository, and the deployment
shapes described in [`docs/`](docs).

Out of scope here, and in scope for the [core's
policy](https://github.com/webamigos/RagenAI/blob/main/SECURITY.md): anything in
Ragen itself — the applications, the shared packages, tenant isolation,
encryption, PII masking. If you are unsure which applies, report it to the same
address and say so; we will route it.

Third-party infrastructure a deployment chooses to run — Temporal, Redis,
Postgres, a cloud model provider — should be reported to its vendor. If Ragen
configures one of them insecurely by default, that is our bug and we want to
hear about it.
