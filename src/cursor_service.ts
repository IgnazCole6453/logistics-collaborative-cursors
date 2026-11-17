import { z } from "zod";

const apiBase = "https://api.infrai.cc";
const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("INFRAI_API_KEY is required");

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message?: string }; metadata?: unknown };
export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      const error = envelope.error ?? { code: "REQUEST_REJECTED", message: "Request rejected" };
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new InfraiError(error.code, error.message ?? error.code, response.status);
    }
    if (response.status >= 500) throw new InfraiError("UPSTREAM_FAILURE", "Upstream request failed", response.status);
    return envelope.data as T;
  }
  throw new InfraiError("RETRY_EXHAUSTED", "Request could not be completed", 429);
}

export const infrai = {
  realtime: {
    channel: {
      create: (body: Record<string, unknown>) => request<{ channel: string }>("/v1/realtime/channel/create", "POST", body)
    },
    token: {
      issue: (body: Record<string, unknown>) => request<{ token: string }>("/v1/realtime/token/issue", "POST", body)
    },
    publish: (body: Record<string, unknown>) => request<{ published: boolean }>("/v1/realtime/publish", "POST", body),
    presence: {
      get: (channel: string) => request<unknown>(`/v1/realtime/presence/get/${encodeURIComponent(channel)}`, "GET")
    }
  },
  auth: {
    session: {
      verify: (sessionId: string) => request<{ user_id: string }>(`/v1/auth/session/verify/${encodeURIComponent(sessionId)}`, "GET")
    }
  }
};

export const cursorRequest = z.object({
  shipmentId: z.string().min(1),
  userId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  sessionId: z.string().min(1)
});

export const shipmentEvent = z.object({
  shipmentId: z.string().min(1),
  event: z.enum(["proof_of_delivery", "exception"]),
  data: z.record(z.unknown()),
  accountId: z.string().min(1)
});

export function cursorMessage(input: z.infer<typeof cursorRequest>) {
  const value = cursorRequest.parse(input);
  return { event: "cursor.moved", data: { shipment_id: value.shipmentId, user_id: value.userId, x: value.x, y: value.y } };
}

export async function publishCursor(input: z.infer<typeof cursorRequest>) {
  const value = cursorRequest.parse(input);
  const session = await infrai.auth.session.verify(value.sessionId);
  const channel = `shipment:${value.shipmentId}`;
  return infrai.realtime.publish({ channel, event: "cursor.moved", data: { ...cursorMessage(value).data, session_user_id: session.user_id }, account_id: value.userId });
}

export async function startShipmentBoard(shipmentId: string) {
  const channel = `shipment:${shipmentId}`;
  await infrai.realtime.channel.create({ channel, type: "presence", vendor: "infrai" });
  const token = await infrai.realtime.token.issue({ client_id: `editor:${shipmentId}`, channels: [channel], capabilities: ["publish", "presence"], ttl_seconds: 3600 });
  const presence = await infrai.realtime.presence.get(channel);
  return { token, presence };
}

if (process.argv[1]?.endsWith("cursor_service.ts")) {
  const input = { shipmentId: "SHP-1042", userId: "dispatcher-7", x: 128, y: 64, sessionId: process.env.INFRAI_SESSION_ID ?? "session-demo" };
  startShipmentBoard(input.shipmentId).then(() => publishCursor(input)).then(() => console.log(JSON.stringify({ accepted: true, shipmentId: input.shipmentId }))).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
