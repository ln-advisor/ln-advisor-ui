# Step 52: Phala Minimal Live App Evidence Binding

Goal:
- let `/api/verify` accept caller-supplied live `/info` and `/attestation` payloads
- compare those payloads against the ARB attestation fields and digest

Done when:
- valid live app evidence passes verification
- mismatched `report_data` fails verification
- mismatched compose hash evidence fails verification
