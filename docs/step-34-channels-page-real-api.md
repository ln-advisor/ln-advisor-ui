# Step 34: ChannelsPage Real API Flow

Objective:
- replace the remaining `ChannelsPage` mock Props recommendation path with the real API-backed recommend + verify flow

Files:
- `src/pages/ChannelsPage.jsx`
- `src/pages/channelsPropsFlow.js`
- `scripts/test-step34-channels-page-real-api.ts`

Behavior:
- modal analysis now:
  - builds a full frontend telemetry envelope
  - calls `POST /api/recommend`
  - calls `POST /api/verify`
  - maps the returned fee recommendation back to the selected channel via deterministic `channelRef`

Test:
- `pnpm step34:test`

Artifact:
- `artifacts/step34.ui-verified-flow.json`

Done condition:
- `ChannelsPage` no longer depends on `MOCK_RECOMMENDATION_API` and displays verified API recommendations for the selected channel modal flow
