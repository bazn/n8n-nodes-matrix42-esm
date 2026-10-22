# Matrix42 → n8n in real time (webhook pattern)

The **Matrix42 ESM Trigger** node polls Matrix42. That works without any change on the Matrix42 side, but events arrive only at the next poll, typically after one minute or more. When events must arrive within seconds, let Matrix42 push them to an n8n webhook.

Matrix42 workflows cannot react to the creation or change of a record by themselves, and a compliance rule cannot make an HTTP call. The pattern therefore has three links: a **compliance rule** detects the change and starts a **workflow**, and the workflow calls n8n with the **Http Send** activity.

```
Matrix42                                                                                                  n8n
┌─────────────────────────┐          ┌──────────────────────────┐  HTTP   ┌─────────────────────────────────┐
│ Compliance rule         │ start    │ Workflow (Studio)        │  POST   │ Webhook (Header Auth)           │
│ data-related, e.g.      │ ───────▶ │ ForEach ObjectContexts   │ ──────▶ │  ├─ 202 Accepted                │
│ "Create an Object"      │ workflow │   └─ Http Send           │         │  └─ Matrix42 ESM › Ticket › Get │
└─────────────────────────┘          └──────────────────────────┘         └─────────────────────────────────┘
```

## n8n side

1. Import [`examples/matrix42-webhook-receiver.json`](../examples/matrix42-webhook-receiver.json). It requires the Matrix42 ESM nodes to be installed.
2. Create an **Header Auth** credential, for example with header name `X-N8N-Token` and a long random value. Select it on the *Matrix42 Event Webhook* node. Do not check the token in an IF node or put it in a text field.
3. Select your **Matrix42 ESM API** credential on *Get Ticket*.
4. Replace *Your logic*, then publish the workflow. Use the **production** URL, `…/webhook/matrix42/ticket-event`. The test URL only works while the editor is listening.

The webhook answers **202 Accepted** right away, so the Matrix42 workflow never waits for n8n. Calls without an `ObjectId` get a **400**.

## Matrix42 side

### 1. Workflow that calls n8n (Workflow Studio)

1. In Workflow Studio choose **New** and the template **Compliance Rules – WF Template**. Set the **Integration Context** to **Compliance Rules**.
2. The template creates the input argument **`ObjectContexts`** (type `ObjectActionContext[]`). It is always a list, even for a single object. Each entry has these fields:

   | Field | Content |
   |---|---|
   | `ID` | object ID of the affected record |
   | `CI` | ID of its configuration item type |
   | `Created` | time of the event |
   | `User` | user who caused the event |

3. Add a **ForEach** over `ObjectContexts` (type argument `ObjectActionContext`). In its body, add an **Http Send** activity:

   | Property | Value |
   |---|---|
   | Method | `POST` |
   | Uri | the n8n production URL, e.g. `https://n8n.example.com/webhook/matrix42/ticket-event` |
   | Content Type | `JSON` |
   | Headers | `X-N8N-Token` = the value of the n8n Header Auth credential |
   | Request Data | `{"ObjectId": "<item.ID>", "TypeId": "<item.CI>", "Event": "created"}` |
   | Retry | as needed; consider *Ignore failure* if a failed call must not fail the workflow |

   Keep the token out of the workflow definition where your Matrix42 version allows it, for example by using a service connection.
4. Publish the workflow.

### 2. Compliance rule that starts the workflow

1. Create a **data-related compliance rule** on the configuration item you want to watch, e.g. incidents.
2. Set the condition. Use the condition type **Create an Object** for new records. For changes, add conditions on the attributes whose changes should count; an update only fires when one of these attributes changes.
3. Under **Actions**, choose **Start Workflow** and select the workflow from step 1.
4. Choose the processing option:
   - Use *process each compliance rule event for each object* to call n8n once per event.
   - For imports and mass changes, use the option that processes the events conjointly. The workflow then receives several objects in `ObjectContexts`, and the ForEach sends one call per object.

> **Workflow Designer:** in newer Matrix42 versions, the Workflow Designer offers the triggers *On record creation* and *On record update*. These are backed by compliance rules as well. Where available, such a workflow can call n8n directly, without configuring a separate rule.

Send **only identifiers** in the payload and read the current data with the Matrix42 ESM node, as the template does. This keeps the payload stable when the Matrix42 data model changes, and the n8n side always works with fresh data.

References: [Execute workflows from actions](https://docs.matrix42.com/en_US/walkthroughs/3504635_execute-workflows-from-actions), [General workflow activities (Http Send)](https://docs.matrix42.com/delivered-activities/3502051_matrix42-workflow-studio-general-workflow-activities), [Automation workflow example with a compliance rule](https://docs.matrix42.com/en_US/1068603_unified-user-experience-knowledgebase/3472776_automation-workflow-activities-example).

## When to use which

| | Matrix42 ESM Trigger (polling) | Webhook pattern |
|---|---|---|
| Latency | Poll interval | Seconds |
| Matrix42 change needed | No | Yes (a compliance rule and a workflow) |
| Missed events if n8n is down | No: catches up from the last position | Yes, unless Http Send retries long enough |
| Events available | Ticket created/updated, journal entry, workflow waiting, any data definition | Anything a compliance rule can detect |

A robust combination is to use the webhook for speed and to run the polling trigger with a long interval as a safety net. Deduplicate by `ObjectId` and `LastChangeDate`, for example in an n8n Data Table.
