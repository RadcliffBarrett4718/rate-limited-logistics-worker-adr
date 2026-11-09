import { infrai, type ConsumedMessage } from "./infrai";
import { decideShipmentOutcome, shipmentJobSchema, type ShipmentOutcome } from "./shipment_events";

export type WorkerDecision = {
  shipmentId: string;
  messageId: string;
  action: "ack" | "nack";
  outcome: ShipmentOutcome;
};

export async function processShipmentMessage(queueName: string, message: ConsumedMessage): Promise<WorkerDecision> {
  const job = shipmentJobSchema.parse(message.payload);
  const outcome = decideShipmentOutcome(job);

  if (outcome.status === "completed") {
    await infrai.queue.ack({ queue: queueName, message_id: message.message_id });
    return {
      shipmentId: job.shipmentId,
      messageId: message.message_id,
      action: "ack",
      outcome
    };
  }

  await infrai.queue.nack({ queue: queueName, message_id: message.message_id });
  return {
    shipmentId: job.shipmentId,
    messageId: message.message_id,
    action: "nack",
    outcome
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, handler: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await handler(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runShipmentWorkerOnce(params: {
  queueName: string;
  maxMessages: number;
  concurrency: number;
  visibilityTimeout: number;
}): Promise<WorkerDecision[]> {
  const consumed = await infrai.queue.consume({
    queue: params.queueName,
    max_messages: params.maxMessages,
    visibility_timeout: params.visibilityTimeout
  });

  const messages = consumed.messages ?? [];
  return mapWithConcurrency(messages, params.concurrency, async (message) => processShipmentMessage(params.queueName, message));
}
