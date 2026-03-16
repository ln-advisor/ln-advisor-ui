# Step 48: Phala Minimal Attestation Policy

Goal:
- attach prototype attestation evidence to the minimal ARB
- enforce a simple attestation policy in `/api/verify`

Scope:
- env-configured attestation evidence only
- no live quote fetching or live attestation verification yet
- policy checks execution mode, provider id, measurement, quote format, and digest-to-report-data binding

Done when:
- a matching attestation passes verification
- tampered measurement or report-data binding fails verification
