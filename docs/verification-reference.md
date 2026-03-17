# Verification Reference

## Review before send

On verified pages, click:

- `Review Request`

Before any request is sent, the modal shows:
- route
- transport
- planned requests
- exact primary request body
- request size in bytes

Use:
- `Cancel` to stop
- `Send Request` to continue

## Where to inspect outgoing data after a run

Expand:

- `Request Inspector`

### Stage 1: Raw
- local input counts and extracted data used for the run

### Stage 2: Normalized
- normalized intermediate state

### Stage 3: Outgoing Payload
- reduced payload prepared for the recommendation run

### Stage 4: Network Requests
- exact endpoint
- HTTP method
- request body
- request body size in bytes

## Verification Status fields

After a verified run, the `Verification Status` panel shows:

### Signer
- signer provider id used by the verification result

### Signer Type
- signer provider type reported by verification

### Runtime Check
- whether cloud quote verification succeeded

### Measurement
- pinned measurement value when available

### Runtime Source
- app runtime source reported by the verified service

### Live Verification
- whether live app evidence is required by the verification policy
