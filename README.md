<div align="center">

# Matrix42 ESM for n8n

**Automate Matrix42 Enterprise Service Management with n8n:** tickets, approvals, workflows, attachments, assets and any other data, plus a trigger for everything that changes.

[![npm version](https://img.shields.io/npm/v/@bazulu1/n8n-nodes-matrix42-esm.svg)](https://www.npmjs.com/package/@bazulu1/n8n-nodes-matrix42-esm)
[![npm downloads](https://img.shields.io/npm/dm/@bazulu1/n8n-nodes-matrix42-esm.svg)](https://www.npmjs.com/package/@bazulu1/n8n-nodes-matrix42-esm)
[![CI](https://github.com/bazn/n8n-nodes-matrix42-esm/actions/workflows/ci.yml/badge.svg)](https://github.com/bazn/n8n-nodes-matrix42-esm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-EA4B71.svg)](https://docs.n8n.io/integrations/community-nodes/)

</div>

---

## Highlights

- **Complete ticket lifecycle:** create, update, forward, pause, close and reopen tickets, incidents, service requests, tasks and changes, and look them up by ticket number.
- **Approvals and workflows:** decide change approvals and service catalog orders, resume waiting Matrix42 workflows or start new ones.
- **Attachments in both directions:** upload and download files on tickets or any other object.
- **A trigger for everything:** new or changed tickets, new journal entries, waiting workflows, and changes to *any* data definition. Filter by category, role, service, asset, OU, location, cost center or configuration item.
- **Comfortable to use:** categories, roles, users, services and templates are searchable lists loaded live from your instance. Picklists show their localized names.
- **AI-agent ready:** every operation can be used as a tool by n8n AI agents.
- **Tested against a real Matrix42 instance:** unit tests and an end-to-end suite are part of the project.

## Contents

- [Installation](#installation)
- [Credentials](#credentials)
- [Matrix42 ESM node](#matrix42-esm-node)
- [Matrix42 ESM Trigger](#matrix42-esm-trigger)
- [Examples](#examples)
- [Good to know](#good-to-know)
- [Development](#development)
- [Releasing](#releasing)
- [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [License](#license)

## Installation

**Self-hosted n8n (also in Docker)**

1. Open **Settings → Community Nodes → Install**.
2. Enter `@bazulu1/n8n-nodes-matrix42-esm`, confirm the notice and install.
3. Search for **Matrix42 ESM** in the node panel.

In Docker the package lives in the persistent `~/.n8n/nodes` volume and survives restarts. Updates are offered on the same settings page.

<details>
<summary>Install without the UI (e.g. for queue-mode workers)</summary>

```bash
docker exec -it <n8n-container> sh -c "mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && npm install @bazulu1/n8n-nodes-matrix42-esm"
docker restart <n8n-container>
```

</details>

> n8n Cloud only allows community nodes that n8n has verified. This package is currently meant for self-hosted n8n.

## Credentials

Choose the method under **Authentication** on the node.

| Credential | Fields |
|---|---|
| **Matrix42 ESM API** *(recommended)* | Matrix42 URL, **API token** (*Administration → Integration → API Tokens*), language, Ignore SSL Issues |
| **Matrix42 ESM Basic Auth API** | Matrix42 URL, **username** (e.g. `DOMAIN\user`) and **password**, language, Ignore SSL Issues |

- The API token is exchanged automatically for a short-lived access token. Matrix42 rejects an expired access token with **HTTP 406, not 401**; the node handles this, so expired access tokens are renewed reliably.
- **Language** (default `de-DE`) controls the display names of picklist values.
- **Ignore SSL Issues** accepts self-signed certificates. Use it on test systems only.
- The account needs read and write rights on the objects your workflows touch.

## Matrix42 ESM node

### Service desk

| Resource | Operations |
|---|---|
| **Ticket** | Create, Get, Get Many, Update, Close, Reopen, Accept, Take Over, Forward, Pause, Set Deadline, Return to Role, Track Working Time, Transform, Classify. The actions work on tickets of **any** type. |
| **Incident** | Like Ticket, plus Propose Major, Decline Major Proposal, Set Major and Revert Major |
| **Service Request** | Like Ticket, scoped to service requests |
| **Task** | Create, Get, Get Many, Update, Close, and the ticket actions |
| **Change** | Create (with a change template), Get, Get Many, Update, Close, Get Approvals, Decide Approval, and the ticket actions |
| **Journal** | Add an entry (optionally visible in the portal), Get Many |
| **Attachment** | Upload, Get Many, Download, Delete, on tickets or on any object |

A ticket can be selected from a searchable list, by **ticket number** (e.g. `INC00123`) or by **object ID**. Ticket outputs always contain `ObjectId` and `TicketType`.

### Processes

| Resource | Operations |
|---|---|
| **Approval** | Get Many, Get (with bookings), Decide (approve or reject; also only selected bookings) for approval tasks of service catalog orders |
| **Workflow** | **Resume** a suspended workflow that waits at a trigger or wait activity, Get Many Waiting, **Start** a workflow with its arguments mapped field by field. Resume and Start can wait for completion. |
| **Import** | Execute an import definition (with parameters, optionally waiting for completion), Get Progress |

### Data

| Resource | Operations |
|---|---|
| **Asset** | Get (optionally as the complete configuration item), Get Many (search by computer name, serial or inventory number, or ASQL) |
| **User** | Get, Get Many (by e-mail, name, department or ASQL) |
| **Data Query** | Get Data from any data query defined in Matrix42 (search, order, columns, user filters, paging) |
| **Object** | Any data definition. Fragments: Get, Get Many (ASQL), Create, Update, Delete. Configuration items: Get, Create, Update, Delete Full Object |

### Ticket filters

*Get Many* and the trigger share the same filters. Each filter accepts several values. Values within one filter are combined with **OR**, different filters with **AND**.

| Filter | Matches when … |
|---|---|
| Ticket types, status, priority | the ticket has one of the selected values |
| Categories | the category is one of them, **including subcategories** by default |
| Responsible roles / users | the ticket is assigned to one of them |
| Services | the reported service, or for incidents the affected service, is one of them |
| Assets | the reported or affected asset is one of them (asset ID or object ID) |
| Organizational units / locations | the ticket's OU or location is one of them, **including sub-units** by default |
| Cost centers | the ticket's cost center is one of them |
| Configuration items | at least one linked configuration item is one of them |
| Text, dates, ASQL | subject contains, created or updated after, and any custom ASQL condition |

## Matrix42 ESM Trigger

| Event | Fires when … | Filters |
|---|---|---|
| **Ticket Created** | a new ticket is created | ticket filters |
| **Ticket Created or Updated** | a ticket is created or changed | ticket filters |
| **Journal Entry Added** | a comment or other journal entry is added | ticket filters, only with text, only visible in portal, ignore entries by a user (to avoid sync loops) |
| **Workflow Waiting** | a workflow stops at a waiting activity | workflow name, activity |
| **Object Created or Updated** | a record of **any data definition** (users, computers, contracts, …) is created or changed | columns, ASQL |

- Each poll delivers **all** new items since the previous poll, one item each.
- On activation the trigger starts at the newest existing item, so history is never replayed.
- Executed manually in the editor, the trigger shows the items the active trigger has not delivered yet. If there are none, it shows all items of the last 60 minutes (configurable). The stored position is never moved by a manual run.
- Need events within seconds instead of polling? See the [webhook pattern](docs/webhook-pattern.md).

## Examples

| Use case | How |
|---|---|
| Ticket from e-mail | Email trigger → **User** Get Many (by e-mail) → **Incident** Create with the user as initiator → **Attachment** Upload |
| Two-way comment sync | **Trigger: Journal Entry Added** (ignore the integration user) → post to Teams, Jira, …; and the other way round **Journal** Add |
| Approvals in chat | **Approval** Get Many (open) → send to Teams or Slack → **Approval** Decide |
| Hand over to n8n and back | Matrix42 workflow waits at a trigger activity → **Trigger: Workflow Waiting** → do the work in n8n → **Workflow** Resume |
| Asset change notifications | **Trigger: Object Created or Updated** on `SPSComputerClassBase` with an ASQL filter → notify the owner |
| Real-time events | Import [examples/matrix42-webhook-receiver.json](examples/matrix42-webhook-receiver.json) and follow the [webhook pattern](docs/webhook-pattern.md) |

## Good to know

<details>
<summary><b>Time zones</b></summary>

Matrix42 stores and compares timestamps as server wall-clock time and labels them with `Z`, although they are not UTC. Date inputs are therefore sent as wall-clock time in the **workflow's time zone**. Set the workflow (or instance) time zone to the time zone of the Matrix42 server. Output timestamps are returned exactly as Matrix42 delivers them.
</details>

<details>
<summary><b>Get Many and ASQL</b></summary>

Get Many uses the Fragments API (`data/fragments`) with ASQL. The per-type search services return only tickets in the queues of the API user, so they are not used. Add columns with ASQL expressions such as `Recipient.LastName as RecipientLastName`. Sort columns are added to the column list automatically, because the API requires that.
</details>

<details>
<summary><b>Workflows</b></summary>

- **Resume:** a workflow that waits at a trigger or wait activity is suspended and owns an active bookmark. *From List* shows only waiting workflows. The bookmark is checked before and after resuming. In the mode *By Waited Object ID*, Matrix42 always answers `true`, even when no workflow waits for that object.
- **Start:** the workflow ID is the object ID of the workflow's XAML component. This also works for Workflow Designer flows that use a call trigger.
</details>

<details>
<summary><b>Objects, attachments and approvals</b></summary>

- **Delete** (fragment) removes only that data definition of an object; the object and its other data remain. Use **Delete Full Object** to remove a record completely.
- Attachments go to the storage that Matrix42 assigns to the object type; its size limit is checked before the upload. External blob storage is supported but has not been tested yet.
- **Approve** approves all bookings of an approval task, or only those listed under *Only These Bookings*; the rest is rejected. When one task of an order is rejected, Matrix42 may remove the other open tasks of that order.
- **Classify** requires the Matrix42 AI features on the instance.
</details>

<details>
<summary><b>Watching any data definition</b></summary>

- Changes are detected with the rowversion `TimeStamp`, which increases on every change across the whole database. No change is missed and none is reported twice.
- Only changes to the selected data definition count. A computer, for example, consists of several data definitions (`SPSAssetClassBase`, `SPSComputerClassBase`, …); choose the one that matters.
- Deleted records are not reported.
- Without *Columns*, all attributes and single-valued relations are returned. Where a data definition has its own attribute `ObjectId`, the technical object ID is returned as `CiObjectId`.
</details>

## Development

```bash
npm ci
npm run build       # compile to dist/
npm run lint        # n8n community node lint rules
npm test            # unit tests (node:test, no extra dependencies)
npm run dev         # local n8n with hot reload

# end-to-end tests against a Matrix42 instance (creates "[n8n-test]" tickets and closes them again)
M42_URL=https://m42.example.com M42_API_TOKEN=… npm run test:live
```

Tests that change data which does not belong to the test run are opt-in. Set `M42_TEST_APPROVAL_TASK`, `M42_TEST_RESUME_BOOKMARK` or `M42_TEST_START_WORKFLOW` to enable them. The API behaviour that the code relies on is documented next to the code.

## Releasing

Releases are built by GitHub Actions and published to npm with **staged publishing**: the workflow uploads a new version as *staged*, and it becomes public only after a maintainer approves it with 2FA.

### One-time setup

1. Publish the first version manually: `npm publish` (npm asks for 2FA in the browser). *Done for 0.7.0.*
2. On npmjs.com open the package → **Settings → Trusted Publisher → GitHub Actions** and enter:

   | Field | Value |
   |---|---|
   | Organization or user | `bazn` |
   | Repository | `n8n-nodes-matrix42-esm` |
   | Workflow filename | `publish.yml` |
   | Environment | *(empty)* |
   | Allowed actions | **npm stage publish** only. Leave *npm publish* unchecked. |

### Every release

1. Make sure `main` is green in CI and pull it: `git pull`.
2. Add a section for the new version at the top of `CHANGELOG.md`, e.g. `## 0.7.1`, and commit it.
3. Bump the version. This creates a commit and the tag `vX.Y.Z`:
   ```bash
   npm version patch   # bug fixes
   npm version minor   # new features
   npm version major   # breaking changes
   ```
4. Push the commit and the tag:
   ```bash
   git push --follow-tags
   ```
5. Wait for the **Publish** workflow in the Actions tab. It checks that the tag matches `package.json`, runs lint and unit tests, stages the version on npm and creates a GitHub release from the changelog section.
6. **Approve the staged version** with 2FA, either on npmjs.com (package → staged versions) or in the terminal:
   ```bash
   npm stage list @bazulu1/n8n-nodes-matrix42-esm   # shows the stage ID of the new version
   npm stage view <stage-id>                         # optional: check the details
   npm stage approve <stage-id>                      # publishes it (asks for 2FA)
   ```
   Only now is the version public. Use `npm stage reject <stage-id>` to discard it, or `npm stage download <stage-id>` to inspect the tarball first.
7. Update the package in n8n: **Settings → Community Nodes**.

### If something goes wrong

- **"Tag … does not match package.json version"**: the tag was not created by `npm version`. Delete it (`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`), fix the version and tag again.
- **Lint or tests fail in the workflow:** nothing was published. Fix the problem, then bump to the next patch version; a version number cannot be reused on npm.
- **A wrong version was approved:** deprecate it with `npm deprecate @bazulu1/n8n-nodes-matrix42-esm@X.Y.Z "reason"` and release a fixed version. Unpublishing is only possible within 72 hours.
- Optional before a release: run the end-to-end tests against a test instance, locally with `npm run test:live` or with the **Live tests** workflow (needs the repository secrets `M42_URL` and `M42_API_TOKEN`).


## Author

**Dominik Vogt**, n8n Ambassador · [vogt.dom@gmail.com](mailto:vogt.dom@gmail.com)

## License

[MIT](LICENSE.md)

Matrix42 and the Matrix42 logo are trademarks of Matrix42. This is an independent community project. It is not affiliated with or endorsed by Matrix42; the logo is used only to identify the integration.
