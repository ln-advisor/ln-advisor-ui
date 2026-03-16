# Step 53: Phala Minimal Cloud App Verification

Goal:
- extend live app evidence verification so `/api/verify` can call Phala's cloud attestation API
- require the cloud verifier to accept the quote when live app evidence policy enables cloud verification

Done when:
- valid live app evidence with a cloud-verified quote passes verification
- a structurally valid bundle with an unverified quote fails verification
- the rendered compose includes the cloud verification runtime values
