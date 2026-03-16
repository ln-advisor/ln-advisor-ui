# Step 55: Phala Minimal Pinned Runtime Measurement

Goal:
- stop treating runtime measurement pinning as a manual copy-paste task
- add a helper that reads the live runtime measurement from `/attestation`
- write that measurement back into the deploy env and rerender the compose with a pinned allow-list

Done when:
- the helper updates `PROTOTYPE_VERIFY_ALLOWED_MEASUREMENT`
- the helper also updates `PROTOTYPE_ATTESTATION_MEASUREMENT` for env consistency
- `/health` exposes whether the runtime measurement policy is still using the placeholder or is actually pinned
- the rendered compose contains the pinned measurement after the helper runs
