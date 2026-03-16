# Step 47: Phala Minimal Signer Provider Abstraction

Goal:
- move the minimal Phala prototype from direct HMAC calls to a signer-provider runtime
- keep `env_hmac` as the working provider
- add a `phala_kms_stub` provider that fails closed so the next real provider slot is explicit

Done when:
- `/api/recommend` signs through the provider runtime
- `/api/verify` validates signer metadata through the provider runtime policy
- selecting `phala_kms_stub` blocks signing with a clear error
