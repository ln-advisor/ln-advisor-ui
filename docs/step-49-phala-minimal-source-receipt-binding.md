# Step 49: Phala Minimal Source Receipt Binding

Goal:
- add a lightweight source receipt to the minimal prototype
- bind that receipt to the ARB with `sourceReceiptHash`
- let verification require a source receipt by policy

Scope:
- this is provenance metadata for submitted telemetry
- it is not authenticated source proof

Done when:
- `/api/recommend` returns `sourceReceipt`
- `/api/verify` can require the receipt and reject missing or tampered receipts
