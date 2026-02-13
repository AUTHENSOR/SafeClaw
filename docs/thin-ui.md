# Thin UI

SafeClaw includes a standalone approvals UI at `ui/approvals/`. This is a minimal single-page app for reviewing and resolving pending approvals, separate from the full dashboard.

## Access

The thin UI is served by the SafeClaw dashboard server:

```
http://localhost:7702/approvals/
```

To point it at a different control plane or install ID, pass query params:

```
http://localhost:7702/approvals/?controlPlane=https://authensor-api-production.up.railway.app&installId=YOUR_INSTALL_ID
```

## Endpoints used

- `GET /api/approvals` -- list pending approvals
- `POST /api/approvals/:id/approve` -- approve a request
- `POST /api/approvals/:id/reject` -- reject a request
- `GET /api/receipts` -- list recent receipts

## Security notes

- The dashboard runs on localhost and is not exposed to the network by default.
- For remote access, place behind authentication (e.g., SSH tunnel, VPN, or reverse proxy with auth).
