# Policies

Policies are JSON documents that control what SafeClaw can do. Each install has its own policy file.

## Policy shape
```
{
  "id": "safeclaw-default",
  "version": "v1",
  "name": "SafeClaw Default Policy",
  "defaultEffect": "deny",
  "rules": [
    {
      "id": "allow-safe-readonly",
      "effect": "allow",
      "condition": {
        "any": [
          { "field": "action.type", "operator": "startsWith", "value": "safe.read" }
        ]
      }
    }
  ]
}
```

See `policies/policy.schema.json` for a schema you can validate against.

## Effects
- allow
- deny
- require_approval

## Fields
Common fields to match:
- action.type
- action.resource
- principal.id
- run.id

## Operators
Recommended operators:
- eq
- in
- startsWith
- contains
- matches (regex)

## Examples

Require approval for secrets or network:
```
{
  "id": "require-approval-risky",
  "effect": "require_approval",
  "condition": {
    "any": [
      { "field": "action.type", "operator": "startsWith", "value": "secrets." },
      { "field": "action.type", "operator": "startsWith", "value": "network." }
    ]
  }
}
```

Allowlist a specific domain:
```
{
  "id": "allow-http-api",
  "effect": "allow",
  "condition": {
    "all": [
      { "field": "action.type", "operator": "eq", "value": "network.http" },
      { "field": "action.resource", "operator": "startsWith", "value": "https://api.example.com" }
    ]
  }
}
```

## Per-install policy
The CLI stores policies at ~/.safeclaw/policies/<profile>.json by default. Use profiles to create separate policies per install.

## Templates
Starter templates are in `policies/`:
- `default-safe.json`
- `high-risk-approval.json`
- `allowlist.example.json`
- `sandbox-readonly.json`
- `strict-deny.json`
