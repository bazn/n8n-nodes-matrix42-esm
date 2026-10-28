# Changelog

## 0.7.3

- **Fix:** ticket outputs (Get, Get Many, trigger) now contain the description of tickets entered in the Matrix42 web UI. Matrix42 fills only `DescriptionHTML` for them, so `Description` was empty. `DescriptionHTML` is returned as well, and an empty `Description` is filled with its plain text.

## 0.7.2

- Node and credential icons use the official Matrix42 logo

## 0.7.1

- Documentation: release process with staged publishing
- First release published from GitHub Actions with trusted publishing

## 0.7.0

- **Renamed** to `@bazulu1/n8n-nodes-matrix42-esm`. Nodes: *Matrix42 ESM* and *Matrix42 ESM Trigger* (types `matrix42Esm` and `matrix42EsmTrigger`); credential *Matrix42 ESM API* (`matrix42EsmApi`). Workflows that use earlier versions have to switch to the new nodes.
- **Fix:** expired access tokens are renewed reliably. Matrix42 answers HTTP 406, not 401.
- New credential *Matrix42 ESM Basic Auth API* (username and password), selectable under *Authentication*
- *Ignore SSL Issues* option on both credentials (for self-signed certificates)
- Object: Delete (fragment); Create, Update and Delete Full Object (configuration items)
- New resource Data Query: Get Data
- New resource Import: Execute (optionally waiting for completion), Get Progress
- Attachments can be uploaded to and listed on any object, not only on tickets

## 0.6.0

- Trigger: new event "Object Created or Updated" that watches any data definition (users, assets, computers, contracts, locations, …) for new and changed records, with optional columns and ASQL filter

## 0.5.0

- New ticket filters in the trigger (ticket and journal events) and in Get Many: services (reported or affected), assets (reported or affected; asset ID or object ID), organizational units, locations, cost centers and configuration items
- Organizational units and locations include their sub-units by default, like categories

## 0.4.1

- Trigger: a manual execution in the editor now returns all matching items of the last 60 minutes (configurable under Options → Test Run Lookback), also when the workflow has never been active

## 0.4.0

- Filters for multiple categories (optionally including subcategories), responsible roles, responsible users and priorities in the trigger (ticket and journal events) and in Get Many
- Trigger: a manual execution in the editor previews all pending items instead of only the newest one
- Author information updated

## 0.3.0

- Attachment resource: upload, list, download and delete ticket attachments
- Approval resource: list, get and decide approval tasks of service catalog orders
- User resource: get users and find them by e-mail, name or department
- Incident: propose, decline, set and revert major incidents
- Workflow: wait for completion after resume; start arguments mapped field by field from the workflow descriptor
- Trigger: new events "Journal Entry Added" and "Workflow Waiting"
- Unit tests (`npm test`) and live end-to-end tests (`npm run test:live`)
- Docs and template for the real-time webhook pattern

## 0.2.0

- Workflow resource: resume (trigger) suspended workflows waiting at a bookmark, list waiting workflows, start workflows with optional wait for completion

## 0.1.0

- Matrix42 API credential with automatic API-token → access-token exchange
- Matrix42 node: Ticket, Incident, Service Request, Task, Change, Journal, Asset and generic Object resources
- Matrix42 Trigger: polling trigger for created / updated tickets
