# Matrix42 → n8n in real time (webhook pattern)

The **Matrix42 ESM Trigger** node polls Matrix42. That works without any change on the Matrix42 side, but events arrive only at the next poll, typically after one minute or more. When events must arrive within seconds, let Matrix42 push them to an n8n webhook.

```
Matrix42 workflow                                   n8n
┌──────────────────────────────┐   HTTP POST   ┌─────────────────────────────────┐
│ Trigger: On record creation/ │ ────────────▶ │ Webhook (Header Auth)           │
│          update (tickets)    │  {ObjectId,   │  ├─ 202 Accepted                │
│ Action: call web service     │   Event}      │  └─ Matrix42 ESM › Ticket › Get │
└──────────────────────────────┘               └─────────────────────────────────┘
```

## n8n side

1. Import [`examples/matrix42-webhook-receiver.json`](../examples/matrix42-webhook-receiver.json). It requires the Matrix42 ESM nodes to be installed.
2. Create an **Header Auth** credential, for example with header name `X-N8N-Token` and a long random value. Select it on the *Matrix42 Event Webhook* node. Do not check the token in an IF node or put it in a text field.
3. Select your **Matrix42 API** credential on *Get Ticket*.
4. Replace *Your logic*, then publish the workflow. Use the **production** URL, `…/webhook/matrix42/ticket-event`. The test URL only works while the editor is listening.

The webhook answers **202 Accepted** right away, so the Matrix42 workflow never waits for n8n. Calls without an `ObjectId` get a **400**.

## Matrix42 side

Create a workflow in the Workflow Designer:

- **Trigger:** *Bei der Erstellung des Datensatzes* (`OnRecordCreation`) or *Aufzeichnung aktualisieren* (`OnRecordUpdate`), for the configuration items you need (incident, service request, …), optionally with a condition.
- **Action:** an action that performs an HTTP call. Use a POST to the n8n production URL with
  - header `X-N8N-Token: <value from the n8n credential>`
  - header `Content-Type: application/json`
  - body `{"ObjectId": "<object id of the record>", "TicketNumber": "<ticket number>", "Event": "created"}`

Which HTTP action is available depends on your Matrix42 version and configuration: for example a custom *Execute Web Service* action in the Workflow Designer, or a web-service activity in Workflow Studio.

Send **only identifiers** in the payload and read the current data with the Matrix42 ESM node, as the template does. This keeps the payload stable when the Matrix42 data model changes, and the n8n side always works with fresh data.

## When to use which

| | Matrix42 ESM Trigger (polling) | Webhook pattern |
|---|---|---|
| Latency | Poll interval | Seconds |
| Matrix42 change needed | No | Yes (a workflow) |
| Missed events if n8n is down | No: catches up from the last timestamp | Yes, unless the Matrix42 workflow retries |
| Events available | Ticket created/updated, journal entry, workflow waiting | Anything a Matrix42 workflow can trigger on |

A robust combination is to use the webhook for speed and to run the polling trigger with a long interval as a safety net. Deduplicate by `ObjectId` and `LastChangeDate`, for example in an n8n Data Table.
