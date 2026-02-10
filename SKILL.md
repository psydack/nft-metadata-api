---
name: nft-metadata-api
provider: psydack
version: 1.1.0
generated: 2026-02-10T00:00:00.000Z
source: https://www.clawmart.xyz
endpoints: 4
---

# NFT Metadata API

Provider: **psydack** | Network: **base** | Protocol: **x402**

## Free Endpoints

### GET /api/health
### GET /api/pricing

## Paid Endpoints

### POST /api/nft-metadata

Single NFT metadata, normalized shape, `mode: lite|full`.

Price: **$0.001 USDC**

### POST /api/nft-metadata/batch

Batch NFT metadata, up to 100 tokens, preserves request order.

Price: **$0.005 USDC**
