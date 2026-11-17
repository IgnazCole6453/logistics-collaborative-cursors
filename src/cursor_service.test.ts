import { cursorMessage, shipmentEvent } from "./cursor_service.ts";

const message = cursorMessage({ shipmentId: "SHP-1042", userId: "dispatcher-7", x: 12, y: 9, sessionId: "session-1" });
if (message.event !== "cursor.moved" || message.data.shipment_id !== "SHP-1042") throw new Error("cursor decision was not preserved");

const pod = shipmentEvent.parse({ shipmentId: "SHP-1042", event: "proof_of_delivery", data: { file_id: "pod-88", received_by: "A. Chen" }, accountId: "acme-logistics" });
if (pod.event !== "proof_of_delivery" || pod.data.file_id !== "pod-88") throw new Error("proof-of-delivery event was not accepted");

console.log("cursor and shipment event checks passed");
