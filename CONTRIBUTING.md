# Contributing

Issues and pull requests are welcome.

## Reporting a problem

Please include:

- the n8n version and the version of this package;
- the Matrix42 version;
- the resource and operation (or trigger event) you used;
- the error message, with any IDs, tokens and personal data removed.

## Making changes

```bash
npm ci
npm run lint
npm test
```

- Keep the n8n community node lint rules green (`npm run lint`).
- Add unit tests in `test/unit/` for logic that does not need a Matrix42 instance.
- If you change how the node talks to the Matrix42 API, run the end-to-end suite against a test instance:
  `M42_URL=… M42_API_TOKEN=… npm run test:live`. It creates tickets prefixed with `[n8n-test]` and closes them again.
- Document verified API behaviour as a short comment next to the code that relies on it.
- Add an entry to `CHANGELOG.md`.
