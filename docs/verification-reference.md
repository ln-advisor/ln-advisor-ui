# Verification Reference

## Where to inspect outgoing data

Open a channel on the `Channels` page and run `Analyze Channel`.

Then expand:

- `PROPS Pipeline Explorer`

The relevant sections are:

### Stage 1: Raw
- local channel context used for the run

### Stage 2: Normalized
- normalized intermediate state

### Stage 3: PROPS Final Payload
- reduced payload prepared for the recommendation run

### Stage 4: Outgoing Browser Requests
- exact endpoint
- HTTP method
- request body
- request body size in bytes

## Phala Trust Status fields

After a verified run, the `Phala Trust Status` panel shows:

### Signer
- signer provider id used by the verification result

### Signer Type
- signer provider type reported by verification

### Quote Check
- whether cloud quote verification succeeded

### Measurement
- pinned measurement value when available

### Attestation Source
- app attestation source reported by the Phala service

### Live Evidence
- whether live app evidence is required by the verification policy
