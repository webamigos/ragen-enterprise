# Bedrock, Vertex AI and Azure OpenAI

Ragen calls model providers itself. Since
[ADR-49](https://github.com/webamigos/RagenAI/blob/main/docs/adrs/49-the-application-calls-model-providers-itself.md)
there is no proxy container in the path and no `LLM_GATEWAY` switch — the
in-process gateway, `packages/llm-gateway` in the core, is the only path.

This note is about the three providers an enterprise deployment usually has to
use rather than chooses to: the ones that keep traffic inside a cloud account
that is already contracted, audited and network-restricted.

> **The variable names below are illustrative, and the generated
> [configuration reference](https://docs.ragen.ai) is canonical.** It is
> produced from `@ragenai/env`, so it cannot drift from the code; this page can.
> If the two disagree, the reference is right and this page is a bug.

## What each one is actually for

|                    | Buy it for                                                                                                      | Authentication                                  | Embeddings |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------- |
| **Azure OpenAI**   | OpenAI models under an Azure subscription, in a chosen region, on a private endpoint                            | API key + resource base URL                     | yes        |
| **Amazon Bedrock** | Anthropic and others without a second vendor contract; IAM instead of static keys; existing committed AWS spend | the AWS default credential chain                | yes        |
| **Vertex AI**      | Gemini in a chosen Google Cloud region, under an existing GCP org and its VPC controls                          | service account, or the workload's own identity | yes        |

Anthropic's own API is a fourth option and needs nothing but a key. It is the
right choice for a deployment that has no cloud account to satisfy — and the
wrong one for a deployment whose data-residency story is "everything stays in
our AWS account". Note that Anthropic publishes no embeddings endpoint, so an
embedding route can never point at that provider; Bedrock, Vertex and Azure all
serve embeddings.

## How a model reaches Ragen

Two things, always, and they are deliberately separate:

1. **A route** says which upstream serves a model id. Routes are configuration —
   a YAML file, `infra/llm-gateway/routes.yaml` in the core, or your own file
   pointed at by `LLM_ROUTES_PATH`. A route carries no credentials.
2. **Credentials** come from the environment, per provider family, and are read
   once at call time.

A route is three lines. `model` is the _upstream's_ own name for the model,
which is frequently not ours:

```yaml
routes:
  # Azure: the deployment name in your resource.
  gpt-5.4:
    provider: azure
    model: gpt-5.4

  # Bedrock prefixes the region and the vendor. Collapsing the two names would
  # work for most models and break exactly these.
  claude-sonnet-5:
    provider: bedrock
    model: eu.anthropic.claude-sonnet-5

  # Vertex: `location` on the route beats the deployment-wide default, because
  # some models are served from the global endpoint only and 404 in a region.
  gemini-3-flash-preview:
    provider: vertex
    model: gemini-3-flash-preview
    location: global
```

## Azure OpenAI

Set the resource endpoint and key — `AZURE_API_KEY`, `AZURE_API_BASE`, and
`AZURE_API_VERSION` when you need to pin the API version. `model` in the route
is the **deployment name** you created in the resource, which is a name you
chose and not necessarily the model's.

Deployment notes that matter more than the configuration:

- One resource per region. A route set that mixes regions needs one gateway
  configuration per region, not one resource with two endpoints.
- Private Endpoint + `publicNetworkAccess: Disabled` is the usual enterprise
  shape; the gateway is an ordinary HTTPS client, so nothing in Ragen needs to
  know.
- Quota is per deployment, per region. A 429 here is a quota fact, not a
  Ragen fact — the gateway surfaces the upstream status.

## Amazon Bedrock

Set `AWS_BEDROCK_REGION`. **That is the only value the gateway reads**, and the
omission is deliberate: credentials come from the AWS default provider chain, so
an instance role on ECS or EC2, an IRSA role on EKS, or a local SSO session all
work with no secret in the environment at all. Demanding static keys would have
hard-blocked every role-based deployment, which is the normal way to run this.

Consequences worth knowing before you debug:

- **A configured region is not a working credential.** Presence of the variable
  proves nothing; the chain may resolve to nothing. `npm run gateway:preflight
-- --probe` in the core makes one real call per model, which is the only
  check that means anything.
- **Model access is per account and per region.** Anthropic models on Bedrock
  need access granted in the Bedrock console first; until then every call is an
  authorization error that looks like a credential problem.
- **The `eu.` / `us.` prefix is a routing decision**, encoded in the route's
  `model`. An EU-only deployment uses the `eu.` inference profiles, and that is
  the whole of the data-residency configuration.
- **VPC endpoints** (`com.amazonaws.<region>.bedrock-runtime`) keep traffic off
  the public internet with no application change.

## Vertex AI

Set `VERTEX_PROJECT` and `VERTEX_LOCATION`. For credentials there are two
shapes, and the second is better:

- `VERTEX_CREDENTIALS` holding a service-account JSON, or a path to one. Both
  are accepted.
- **Nothing at all**, when the workload has its own identity — Cloud Run, GKE
  Workload Identity, GCE. Google's application default credentials then apply,
  and there is no key to rotate or leak. This is the one provider where "no
  credentials configured" is routinely the correct state.

Notes:

- **`location` on a route wins over `VERTEX_LOCATION`.** Some models are served
  from `global` only; a regional default would 404 them while its neighbours in
  the same table answer.
- Data residency is the location, and it is per route. Two routes in one
  deployment can legitimately sit in two regions.
- The service account needs `roles/aiplatform.user` on the project, no more.

## Before you trust any of this

```bash
npm run gateway:preflight -- --probe
```

In the core repository. Without `--probe` it checks that every route has
credentials in the environment; with it, it makes one real call per model. The
difference is the entire gap between "configured" and "working", and it is the
gap that a role-based or ADC-based deployment lives in.

## What none of this changes

Encryption, tenant scoping and PII masking are core behaviour and do not vary
by provider. A model call carries whatever the retrieval pipeline assembled; if
your requirement is that document text never leaves the account, that is a
statement about _which provider you route to_, and these three are the answer —
not a switch elsewhere in Ragen.
