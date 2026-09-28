# Cost model

The product must calculate cost per operation from actual usage counters. Do not price an operation from a fixed token estimate when the provider returns usage metadata.

## Main cost buckets

| Component | Free/local mode | Remote mode |
|---|---:|---:|
| Browser editing | $0 platform cost | $0 platform cost |
| Browser export | $0 platform cost | $0 platform cost |
| Cloudflare static delivery | Free within current Free-plan limits | Paid only if limits/features require it |
| Cloudflare R2 | $0 while within the current 10 GB + operation allowances | $0.015/GB-month standard storage after allowance; Class A/B after allowances; internet egress free |
| Render compute | not used | plan-dependent; current workspace contains a free renderer, but free compute is finite |
| Gemini 2.5 Flash-Lite | free tier available | $0.10 / 1M input text/image/video tokens and $0.40 / 1M output tokens under current standard paid pricing |
| Gemini 2.5 Flash | free tier available | $0.30 / 1M input text/image/video tokens and $2.50 / 1M output tokens under current standard paid pricing |

## Example AI task calculation

For a task that consumes 20,000 input tokens and 2,000 output tokens on Gemini 2.5 Flash-Lite, the paid-equivalent API cost is:

`20,000 / 1,000,000 * $0.10 + 2,000 / 1,000,000 * $0.40 = $0.0028`

This is a **cost-equivalent calculation**, not a statement that the task will be billed: the provider's free-tier eligibility and current quota must be checked first.

For Gemini 2.5 Flash:

`20,000 / 1,000,000 * $0.30 + 2,000 / 1,000,000 * $2.50 = $0.011`

## Render cost accounting

For each render job store:

- wall-clock seconds
- CPU/RAM plan
- input bytes
- output bytes
- resolution
- duration
- codec/preset
- retry count
- provider/model calls
- token usage
- storage GB-hours/GB-months where applicable

Then compute:

`job_cost = compute_cost + storage_cost + provider_cost + transfer_cost + payment_fees`

The user plan must enforce a maximum monthly cost envelope, not only a maximum number of jobs.

## Important free-tier constraint

A free Render service is suitable for early testing and light workloads but should not be treated as an unlimited commercial rendering pool. The product should queue, throttle and reject jobs that exceed the user's plan or the renderer's capacity.

## Pricing strategy

The local tier can be free and ad-supported because its marginal server cost is near zero. Advanced cloud rendering should be metered because it consumes compute and storage. The recommended initial structure is:

- Free: local editing/export + basic AI + ads.
- Creator: higher AI allowance + advanced analysis + no ads.
- Pro: remote rendering and larger quotas.
- BYOC: user supplies compute; platform charges only for platform features if desired.
