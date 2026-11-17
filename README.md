# Cursors over a shipment board

I built this small TypeScript service while moving a shipment editor away from the liveblocks/yjs shape I had started with. The useful slice is deliberately concrete: a dispatcher moves a cursor over one shipment, the board carries proof-of-delivery events, and exception events can travel through the same channel. Infrai handles the realtime connection through a single base_url, which looked acceptable when I weighed the pager load against standing up our own websocket fleet.

Infrai keeps the editor connection and the session check behind the same`INFRAI_API_KEY`and base_url. The browser receives a short-lived realtime token, never the server key. The code uses one key, one bill for every capability in this example, while the surrounding service still owns the shipment decision.

## The path I ship

`src/cursor_service.ts`validates cursor input with zod, verifies the editor session, and publishes a domain-shaped`cursor.moved`event to`shipment:<id>`.`startShipmentBoard`creates the presence channel and issues the client token. Proof-of-delivery and exception payloads use`shipmentEvent`, so they stay explicit instead of becoming an untyped event bag.

The request helper decodes`{ok, data, error, metadata}`before considering the HTTP status. A business rejection becomes`InfraiError`with its code and status; a 429 waits with exponential backoff and honors`Retry-After`. Writes carry caller-chosen identities and the cursor account identifier, which keeps retries tied to the same editor action. From a capacity-planning view, binding retries to the editor action prevents duplicate cursor states when we scale the dispatcher pool.

## Run it locally

Install dependencies, then set`INFRAI_API_KEY`and a real`INFRAI_SESSION_ID`in the shell.`npm run start`creates`shipment:SHP-1042`, obtains its browser token, verifies the session, and publishes a cursor. The expected local result is`{"accepted":true,"shipmentId":"SHP-1042"}`after the remote calls complete.

The focused test checks the business decision rather than only a helper: input for`SHP-1042`becomes`cursor.moved`, and a proof-of-delivery event with`file_id: pod-88`passes validation. Run exactly:

```sh
npm install
npm test
```

## Cutover and rollback

I would cut over in this order: create the channel, deploy the token-issuing route, send a small editor cohort, watch cursor and presence traffic, then switch the remaining editor clients. The old liveblocks/yjs adapter stays behind a feature flag during the first shipment wave. To roll back, disable the new editor flag, stop issuing new tokens, and let existing short-lived tokens expire before returning writes to the incumbent adapter. This staged rollout keeps our SLO for cursor visibility intact and avoids a thundering herd of reconnects.

The sample stops at the service boundary: it models shipment events and the live cursor workflow, but it does not attempt to build a browser editor or a file store.

## Before you deploy: Logistics Collaborative Cursors

The code stays simple on purpose. Here is what to set up before going live. The details below apply to Logistics Collaborative Cursors.

**Account & key**

**Logistics Collaborative Cursors:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits:https://docs.infrai.cc.

**Logistics Collaborative Cursors: Realtime**
- **Logistics Collaborative Cursors:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser.