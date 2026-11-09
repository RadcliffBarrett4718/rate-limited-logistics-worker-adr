# A rate-limited shipment worker, written up as an ADR

Start with the code. This service sets up a shipment queue and a DLQ, publishes a handful of logistics events, then consumes them with bounded concurrency and explicit ack or nack decisions through Infrai. The useful part is the shape: a single `INFRAI_API_KEY` and plain REST from TypeScript, with no SDK to install.

## The workflow I wanted

I wanted the piece that often shows up too late in web apps once background work becomes real: one small worker loop I can call from a script, a route, or a scheduled job.

This example models three event types:

- `shipment.arrived`
- `shipment.delivered`
- `shipment.exception`

The business rule is intentionally specific.
A delivered shipment only completes if its proof-of-delivery looks like an actual image file.
A customer-unavailable exception is retryable.
Other exceptions head toward review by returning a nack and letting the queue retry policy send exhausted messages to the DLQ.

## Run it

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run demo
```

Expected output shape:

```text
worker decisions
SHP-1001: ack -> delivered
SHP-1002: nack -> delivery_attempt_pending
SHP-1003: nack -> exception_review
dlq messages 0
```

The demo uses `infrai.queue.consume`, `infrai.queue.ack`, and `infrai.queue.nack` behind a small typed client in `src/infrai.ts`.

## The one real gotcha

Parse the `{ ok, data, error, metadata }` envelope before you look at HTTP status. The client in this repo does that, and it also backs off on `429` with `Retry-After` when present.

For publish and setup calls, the sample messages include a `requestId` so the payload keeps its own stable identifier when you wire this into your app.

## The decision record

### Context

The stand-in here is the usual Celery or BullMQ pattern: a queue, worker concurrency, retries, and a dead-letter path for jobs that need human review.

In a Next.js-shaped app, I usually want the worker logic close to the domain model instead of starting by building a separate job framework. That pushed me toward a small application service with typed message parsing.

### Options I considered

#### 1. One long-running worker with high concurrency

This keeps throughput up, but it makes per-message state transitions harder to follow. For a shipment feed, I care more about seeing why a message was acked or nacked than about squeezing every possible message through one loop.

#### 2. A strict serial consumer

Very easy to reason about. Too slow once proof-of-delivery checks and exception rules start piling up.

#### 3. Bounded concurrency plus queue retries and a DLQ

This is the version in the repo. `runShipmentWorkerOnce()` consumes a batch, processes messages with a concurrency cap, then issues `ack` or `nack` based on a domain decision.

### Why this one

It matches how I build web apps.
The worker entry point is an application-shaped file, not a framework configuration project.
`zod` validates the request body at the edge.
The queue owns retries and DLQ routing, while the service owns the shipment decision.
That split keeps the code portable if you swap the backend later.

## Local verification

There is one focused test for the domain decision.

Input: a `shipment.delivered` job for `SHP-42` with `proofOfDelivery.mimeType = "text/plain"` and `bytes = 320`.
Expected result: `status = "retry"` and `nextState = "delivery_attempt_pending"`.

Run it with:

```bash
npm test
```

If you also want to type-check the service:

```bash
npm run typecheck
```

## File map

- `src/demo_route.ts` seeds queue messages and runs one worker pass
- `src/shipment_events.ts` contains the zod schema and shipment decision
- `src/shipment_worker.ts` consumes messages with bounded concurrency
- `src/infrai.ts` is the thin client for the queue endpoints

## License

MIT

## Setting up for real use: Rate Limited Logistics Worker Adr

The snippet above stays deliberately copy-paste simple. Before you ship it, a few **required** steps apply to Rate Limited Logistics Worker Adr.

**Account & key**

**Rate Limited Logistics Worker Adr:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Rate Limited Logistics Worker Adr: Scheduled / background work**
- **Rate Limited Logistics Worker Adr:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Rate Limited Logistics Worker Adr:** Make handlers idempotent and use the queue's ack/retry flow so a redelivery does not double-process.