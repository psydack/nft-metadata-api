# NFT Metadata API

x402 API for normalized NFT metadata with agent-friendly responses.

## Free Endpoints

- `GET /api/health`
- `GET /api/pricing`

## Paid Endpoints

### POST /api/nft-metadata

Request:

```json
{
  "chainId": 1,
  "contract": "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d",
  "tokenId": "1",
  "options": {
    "mode": "lite",
    "refresh": false,
    "timeoutMs": 2000
  }
}
```

### POST /api/nft-metadata/batch

- `tokens.length` must be 1..100
- one `chainId` per request

```json
{
  "chainId": 1,
  "tokens": [
    { "contract": "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d", "tokenId": "1" },
    { "contract": "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d", "tokenId": "2" }
  ],
  "options": {
    "mode": "lite",
    "refresh": false,
    "timeoutMs": 2000
  }
}
```

## Notes

- Supported chains: `1` (Ethereum), `8453` (Base)
- Payment network: Base (`eip155:8453`)
- Cache TTL: lite 12h, full 4h, negative 5min
