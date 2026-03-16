# Step 54: Phala Minimal Real Attestation Source

Goal:
- replace the env-backed prototype quote path with a real runtime attestation source
- read `/info` and `/attestation` from dstack runtime data when configured
- embed the runtime quote into the ARB so cloud verification can succeed with real quote material

Done when:
- `/api/recommend` uses a runtime-backed quote in the ARB
- `/attestation` returns the same runtime-backed quote
- `/api/verify` passes with cloud verification enabled when the runtime quote is accepted
- the service fails closed when `dstack_runtime` is required but unavailable
