import { z } from "zod";

export const proofOfDeliverySchema = z.object({
  podId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  bytes: z.number().int().positive()
});

export const shipmentJobSchema = z.object({
  requestId: z.string().min(1),
  shipmentId: z.string().min(1),
  carrier: z.string().min(1),
  event: z.enum(["shipment.arrived", "shipment.delivered", "shipment.exception"]),
  occurredAt: z.string().datetime(),
  proofOfDelivery: proofOfDeliverySchema.optional(),
  exception: z
    .object({
      code: z.enum(["ADDRESS_BLOCKED", "CUSTOMER_UNAVAILABLE", "DAMAGED_IN_TRANSIT"]),
      note: z.string().min(1)
    })
    .optional()
});

export type ShipmentJob = z.infer<typeof shipmentJobSchema>;

export type ShipmentOutcome =
  | {
      status: "completed";
      nextState: "out_for_delivery" | "delivered";
      summary: string;
    }
  | {
      status: "retry";
      nextState: "delivery_attempt_pending";
      summary: string;
    }
  | {
      status: "dead-letter";
      nextState: "exception_review";
      summary: string;
    };

export function decideShipmentOutcome(job: ShipmentJob): ShipmentOutcome {
  if (job.event === "shipment.arrived") {
    return {
      status: "completed",
      nextState: "out_for_delivery",
      summary: `Shipment ${job.shipmentId} is staged for delivery.`
    };
  }

  if (job.event === "shipment.delivered") {
    const pod = job.proofOfDelivery;
    if (!pod || pod.bytes < 1024 || !pod.mimeType.startsWith("image/")) {
      return {
        status: "retry",
        nextState: "delivery_attempt_pending",
        summary: `Shipment ${job.shipmentId} needs a valid proof-of-delivery image.`
      };
    }

    return {
      status: "completed",
      nextState: "delivered",
      summary: `Shipment ${job.shipmentId} was delivered with proof ${pod.filename}.`
    };
  }

  const exceptionCode = job.exception?.code;
  if (exceptionCode === "CUSTOMER_UNAVAILABLE") {
    return {
      status: "retry",
      nextState: "delivery_attempt_pending",
      summary: `Shipment ${job.shipmentId} will be retried after customer unavailable.`
    };
  }

  return {
    status: "dead-letter",
    nextState: "exception_review",
    summary: `Shipment ${job.shipmentId} requires manual review for ${exceptionCode}.`
  };
}
