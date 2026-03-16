# Current Scope

This document is intentionally blunt about what is in scope right now.

## Implemented now

### Verified `Channels` flow

The `Channels` page currently has the strongest end-to-end path:
- browser-local node access
- client-side privacy transform
- verified Phala recommendation path
- verification status in UI
- payload inspection in UI

This is the main path that demonstrates the Props model today.

## Not yet moved to Phala

### Node Analysis

`Node Analysis` is not currently on the verified Phala path.
It is still part of the standard/local app flow.

### Opening Recs

`Opening Recs` is also not currently on the verified Phala path.
It remains part of the standard/local app flow.

## What this means for users

If a user wants the strongest current trust/privacy story, they should focus on:
- local/self-hosted frontend
- browser-side LNC connection
- verified `Channels` workflow

That is the path that currently matches the product direction best.

## Practical interpretation

Do not treat every page as equally mature from a trust-model standpoint.

Right now:
- `Channels` is the primary Props path
- the other pages are still transitional

## Likely next product work

The most natural next expansion is:
- extend the same local-first verified model to `Opening Recs`

That is a better fit than trying to force the same pattern onto every exploratory analytics page immediately.
