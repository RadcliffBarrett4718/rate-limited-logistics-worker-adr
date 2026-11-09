import test from "node:test";
import assert from "node:assert/strict";
import { decideShipmentOutcome, shipmentJobSchema } from "./shipment_events";

test("delivered shipment with a non-image proof is retried", () => {
  const input = shipmentJobSchema.parse({
    requestId: "req-test-1",
    shipmentId: "SHP-42",
    carrier: "northwind",
    event: "shipment.delivered",
    occurredAt: "2026-01-10T12:00:00.000Z",
    proofOfDelivery: {
      podId: "pod-test-1",
      filename: "signature.txt",
      mimeType: "text/plain",
      bytes: 320
    }
  });

  const result = decideShipmentOutcome(input);

  assert.deepEqual(result, {
    status: "retry",
    nextState: "delivery_attempt_pending",
    summary: "Shipment SHP-42 needs a valid proof-of-delivery image."
  });
});
