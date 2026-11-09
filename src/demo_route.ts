import { infrai } from "./infrai";
import { runShipmentWorkerOnce } from "./shipment_worker";

const queueName = "shipment-events-demo";
const dlqName = "shipment-events-demo-dlq";

async function ensureQueues(): Promise<void> {
  await infrai.queue.create({ name: dlqName });
  await infrai.queue.create({ name: queueName, dead_letter_queue: dlqName, max_retries: 3 });
}

async function seedJobs(): Promise<void> {
  await infrai.queue.publish_batch({
    queue: queueName,
    messages: [
      {
        requestId: "req-1001",
        shipmentId: "SHP-1001",
        carrier: "northwind",
        event: "shipment.delivered",
        occurredAt: "2026-01-10T12:00:00.000Z",
        proofOfDelivery: {
          podId: "pod-1001",
          filename: "front-door.jpg",
          mimeType: "image/jpeg",
          bytes: 48123
        }
      },
      {
        requestId: "req-1002",
        shipmentId: "SHP-1002",
        carrier: "northwind",
        event: "shipment.delivered",
        occurredAt: "2026-01-10T12:01:00.000Z",
        proofOfDelivery: {
          podId: "pod-1002",
          filename: "note.txt",
          mimeType: "text/plain",
          bytes: 400
        }
      },
      {
        requestId: "req-1003",
        shipmentId: "SHP-1003",
        carrier: "northwind",
        event: "shipment.exception",
        occurredAt: "2026-01-10T12:02:00.000Z",
        exception: {
          code: "ADDRESS_BLOCKED",
          note: "Gate access failed"
        }
      }
    ]
  });
}

async function main(): Promise<void> {
  await ensureQueues();
  await seedJobs();

  const results = await runShipmentWorkerOnce({
    queueName,
    maxMessages: 3,
    concurrency: 2,
    visibilityTimeout: 30
  });

  const dlq = await infrai.queue.dlq.list(queueName);

  console.log("worker decisions");
  for (const result of results) {
    console.log(`${result.shipmentId}: ${result.action} -> ${result.outcome.nextState}`);
  }

  console.log("dlq messages", (dlq.messages ?? []).length);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
