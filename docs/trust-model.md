# Trust Model

LN Prop Advisor is not a "trust nothing" system.
It is a trust-reduced system with a local-first browser boundary.

## What stays local

In the intended operator flow:
- the frontend is run locally by the operator
- the browser connects to the Lightning node through LNC
- raw node telemetry is retrieved in the browser
- normalization and privacy transforms happen in the browser

Examples of raw/local material:
- raw channel data
- raw balances
- raw forwarding history
- raw peer/node identifiers
- browser-held node session state

## What leaves the browser

For the verified `Channels` path, the browser sends a reduced request to the recommendation provider.

The important goal is:
- do not send the full raw node state by default
- send only the reduced payload required for recommendation

The UI now exposes this directly in:
- `Stage 4: Outgoing Browser Requests`

That means the operator can inspect:
- exact endpoint
- exact HTTP method
- exact request body
- request size

## What the user still has to trust

The operator still has to trust:
- the frontend code they chose to run
- the dependencies in that frontend
- the Phala app for the reduced payload it receives

If the operator self-hosts or runs the code locally from source, this trust model is much stronger than using a hosted opaque frontend.

## What the user does not need to trust as much

With the local-first model, the operator does not need to rely on:
- a hidden backend collecting raw node telemetry
- a server-side service automatically seeing all raw node state
- a recommendation provider receiving the full raw node dataset by default

That is the core value of the browser-local Props model.

## What Phala verification proves

In the verified `Channels` flow, the system can prove or check:
- recommendation bundle integrity
- signer metadata
- live app evidence
- app quote verification via Phala cloud verification
- runtime measurement policy

This is shown in the UI through:
- recommendation verification state
- `Phala Trust Status`

## What it does not prove

The current system does not magically prove:
- that the frontend code is safe unless the operator verifies it
- that every non-Phala page uses the same trust model
- that all data sources are production-grade authenticated evidence in every path

That is why the current recommended user story is:
- run locally
- inspect payloads
- use the verified `Channels` path

## Strongest recommended operator posture

For an operator who cares about privacy and provenance:
1. fork or clone the repo
2. run the frontend locally
3. inspect the outgoing payload in the UI
4. use the verified `Channels` path
5. check the verification/trust panel before acting on a recommendation

That is the trust model this repo is moving toward.
