# Thin UI

The UI is intentionally minimal: approvals and receipts only. It does not handle provider keys or run tasks.

## Access
If hosted on the same domain as the server:
```
https://safeclaw.yourdomain.com/ui
```

If hosted separately, pass query params:
```
https://ui.yourdomain.com/?server=https://safeclaw.yourdomain.com&installId=YOUR_INSTALL_ID
```

## Endpoints used
- GET /approvals?status=pending&installId=...
- POST /approvals/:id/approve
- POST /approvals/:id/reject
- GET /receipts?limit=20&installId=...

## Security notes
- The UI should be hosted behind auth if you are using server auth tokens.
- For public demos, keep installIds scoped and rate limited.
