# Step 51: Phala Minimal App Attestation Endpoints

Goal:
- expose prototype `/info` and `/attestation` endpoints from the minimal Phala service
- make those endpoints return evidence that can be compared against the generated ARB

Done when:
- `/info` returns `tcb_info.app_compose`
- `/attestation` returns `quote`, `report_data`, and an event log with the compose hash
- the latest recommendation digest is reflected in `report_data`
