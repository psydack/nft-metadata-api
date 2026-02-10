require('dotenv').config();
const express = require('express');
const { paymentMiddleware } = require('@x402/express');
const { x402ResourceServer, HTTPFacilitatorClient } = require('@x402/core/server');
const { registerExactEvmScheme } = require('@x402/evm/exact/server');
const {
  fetchNftMetadata,
  fetchNftMetadataBatch,
  normalizeContract,
  isValidContract,
  isValidTokenId
} = require('./alchemyService');

const app = express();
app.use(express.json());

const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PORT = process.env.APP_PORT || process.env.PORT || 3000;
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://www.x402.org/facilitator';
const NETWORK = process.env.NETWORK || 'eip155:8453';
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const SINGLE_PRICE = '$0.001';
const BATCH_BASE_PRICE = '$0.005';

const CACHE_LITE_TTL_MS = Number(process.env.CACHE_LITE_TTL_MS || 12 * 60 * 60 * 1000);
const CACHE_FULL_TTL_MS = Number(process.env.CACHE_FULL_TTL_MS || 4 * 60 * 60 * 1000);
const NEGATIVE_CACHE_TTL_MS = Number(process.env.NEGATIVE_CACHE_TTL_MS || 5 * 60 * 1000);

const cache = new Map();

if (!WALLET_ADDRESS) {
  console.error('ERROR: WALLET_ADDRESS environment variable is required');
  process.exit(1);
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const x402Server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(x402Server);

function sendError(res, status, code, message, hint) {
  return res.status(status).json({
    error: {
      code,
      message,
      hint: hint || null
    }
  });
}

function parseOptions(options) {
  const mode = options?.mode === 'full' ? 'full' : 'lite';
  const refresh = options?.refresh === true;
  const timeoutRaw = Number(options?.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(0, Math.min(5000, timeoutRaw)) : 2000;
  return { mode, refresh, timeoutMs };
}

function cacheTtlByMode(mode) {
  return mode === 'full' ? CACHE_FULL_TTL_MS : CACHE_LITE_TTL_MS;
}

function cacheKey(chainId, contract, tokenId, mode) {
  return `${chainId}:${contract}:${String(tokenId).toLowerCase()}:${mode}`;
}

function getFromCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item;
}

function setCacheValue(key, value, ttlMs, isNegative = false) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    isNegative
  });
}

function validateSinglePayload(body) {
  const chainId = Number(body?.chainId);
  const contract = normalizeContract(body?.contract || '');
  const tokenId = String(body?.tokenId || '').trim();

  if (!Number.isInteger(chainId) || (chainId !== 1 && chainId !== 8453)) {
    return { error: ['UNSUPPORTED_CHAIN', `chainId ${body?.chainId} not supported. Use 1 or 8453.`] };
  }
  if (!isValidContract(contract)) {
    return { error: ['INVALID_CONTRACT', 'contract must be a valid 0x address'] };
  }
  if (!isValidTokenId(tokenId)) {
    return { error: ['INVALID_TOKEN_ID', 'tokenId must be decimal or hex string'] };
  }

  return { chainId, contract, tokenId };
}

function validateBatchPayload(body) {
  const chainId = Number(body?.chainId);
  const tokens = Array.isArray(body?.tokens) ? body.tokens : null;

  if (!Number.isInteger(chainId) || (chainId !== 1 && chainId !== 8453)) {
    return { error: ['UNSUPPORTED_CHAIN', `chainId ${body?.chainId} not supported. Use 1 or 8453.`] };
  }
  if (!tokens || tokens.length < 1 || tokens.length > 100) {
    return { error: ['TOKENS_LIMIT_EXCEEDED', 'tokens must contain between 1 and 100 entries'] };
  }

  const normalized = [];
  for (const token of tokens) {
    const contract = normalizeContract(token?.contract || '');
    const tokenId = String(token?.tokenId || '').trim();

    if (!isValidContract(contract)) {
      return { error: ['INVALID_CONTRACT', 'every token.contract must be a valid 0x address'] };
    }
    if (!isValidTokenId(tokenId)) {
      return { error: ['INVALID_TOKEN_ID', 'every token.tokenId must be decimal or hex string'] };
    }
    normalized.push({ contract, tokenId });
  }

  return { chainId, tokens: normalized };
}

app.get('/api/health', (req, res) => {
  res.json({
    service: 'nft-metadata-api',
    status: 'online',
    version: '1.1.0',
    cacheEntries: cache.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/pricing', (req, res) => {
  res.json({
    network: NETWORK,
    currency: 'USDC',
    pricing: {
      singleLite: SINGLE_PRICE,
      batchLiteBase: BATCH_BASE_PRICE,
      batchLitePerToken: '$0.00005',
      refreshMultiplier: 3
    },
    notes: [
      'x402 payment is on Base network.',
      'Data chains supported by this API: 1 (Ethereum), 8453 (Base).'
    ]
  });
});

app.use(paymentMiddleware({
  'POST /api/nft-metadata': {
    accepts: [{ scheme: 'exact', price: SINGLE_PRICE, network: NETWORK, payTo: WALLET_ADDRESS }],
    description: 'Fetch normalized NFT metadata by chain, contract and tokenId',
    mimeType: 'application/json'
  },
  'POST /api/nft-metadata/batch': {
    accepts: [{ scheme: 'exact', price: BATCH_BASE_PRICE, network: NETWORK, payTo: WALLET_ADDRESS }],
    description: 'Fetch normalized NFT metadata in batch (up to 100 tokens in one chain)',
    mimeType: 'application/json'
  }
}, x402Server));

app.post('/api/nft-metadata', async (req, res) => {
  try {
    const parsed = validateSinglePayload(req.body);
    if (parsed.error) {
      return sendError(res, 400, parsed.error[0], parsed.error[1]);
    }

    const options = parseOptions(req.body?.options);
    const key = cacheKey(parsed.chainId, parsed.contract, parsed.tokenId, options.mode);

    if (!options.refresh) {
      const cached = getFromCache(key);
      if (cached) {
        if (cached.isNegative) {
          return sendError(res, 502, 'ALCHEMY_UPSTREAM_ERROR', 'Failed to fetch metadata', 'Cached failure. Try again later or use refresh=true');
        }
        return res.json(cached.value);
      }
    }

    const data = await fetchNftMetadata({
      apiKey: ALCHEMY_API_KEY,
      chainId: parsed.chainId,
      contract: parsed.contract,
      tokenId: parsed.tokenId,
      refresh: options.refresh,
      timeoutMs: options.timeoutMs,
      mode: options.mode
    });

    setCacheValue(key, data, cacheTtlByMode(options.mode));
    return res.json(data);
  } catch (error) {
    const msg = String(error.message || error);
    if (msg.includes('missing_alchemy_key')) {
      return sendError(res, 500, 'CONFIG_ERROR', 'ALCHEMY_API_KEY is required');
    }
    if (msg.includes('unsupported_chain')) {
      return sendError(res, 400, 'UNSUPPORTED_CHAIN', 'Supported chains: 1, 8453');
    }

    const parsed = validateSinglePayload(req.body);
    if (!parsed.error) {
      const options = parseOptions(req.body?.options);
      const key = cacheKey(parsed.chainId, parsed.contract, parsed.tokenId, options.mode);
      setCacheValue(key, { error: true }, NEGATIVE_CACHE_TTL_MS, true);
    }

    return sendError(
      res,
      502,
      'ALCHEMY_UPSTREAM_ERROR',
      'Failed to fetch metadata',
      'Try again or set options.timeoutMs=0 to use cache only'
    );
  }
});

app.post('/api/nft-metadata/batch', async (req, res) => {
  try {
    const parsed = validateBatchPayload(req.body);
    if (parsed.error) {
      return sendError(res, 400, parsed.error[0], parsed.error[1]);
    }

    const options = parseOptions(req.body?.options);
    const results = new Array(parsed.tokens.length);
    const missing = [];

    if (!options.refresh) {
      for (let i = 0; i < parsed.tokens.length; i += 1) {
        const token = parsed.tokens[i];
        const key = cacheKey(parsed.chainId, token.contract, token.tokenId, options.mode);
        const cached = getFromCache(key);

        if (!cached) {
          missing.push({ token, index: i });
          continue;
        }

        if (cached.isNegative) {
          results[i] = {
            chainId: parsed.chainId,
            contract: token.contract,
            tokenId: token.tokenId,
            errors: [{ code: 'ALCHEMY_UPSTREAM_ERROR', message: 'Cached upstream failure' }],
            warnings: []
          };
        } else {
          results[i] = cached.value;
        }
      }
    } else {
      for (let i = 0; i < parsed.tokens.length; i += 1) {
        missing.push({ token: parsed.tokens[i], index: i });
      }
    }

    if (missing.length > 0) {
      const fetched = await fetchNftMetadataBatch({
        apiKey: ALCHEMY_API_KEY,
        chainId: parsed.chainId,
        tokens: missing.map((item) => item.token),
        refresh: options.refresh,
        timeoutMs: options.timeoutMs,
        mode: options.mode
      });

      for (let i = 0; i < missing.length; i += 1) {
        const m = missing[i];
        const data = fetched[i];
        results[m.index] = data;
        const key = cacheKey(parsed.chainId, m.token.contract, m.token.tokenId, options.mode);

        if (Array.isArray(data?.errors) && data.errors.length > 0) {
          setCacheValue(key, { error: true }, NEGATIVE_CACHE_TTL_MS, true);
        } else {
          setCacheValue(key, data, cacheTtlByMode(options.mode));
        }
      }
    }

    return res.json({
      chainId: parsed.chainId,
      count: results.length,
      mode: options.mode,
      results
    });
  } catch (error) {
    const msg = String(error.message || error);
    if (msg.includes('missing_alchemy_key')) {
      return sendError(res, 500, 'CONFIG_ERROR', 'ALCHEMY_API_KEY is required');
    }
    if (msg.includes('unsupported_chain')) {
      return sendError(res, 400, 'UNSUPPORTED_CHAIN', 'Supported chains: 1, 8453');
    }

    return sendError(
      res,
      502,
      'ALCHEMY_UPSTREAM_ERROR',
      'Failed to fetch metadata in batch',
      'Try again or lower options.timeoutMs'
    );
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'NFT Metadata API',
    status: 'online',
    endpoints: {
      single: 'POST /api/nft-metadata',
      batch: 'POST /api/nft-metadata/batch',
      health: 'GET /api/health',
      pricing: 'GET /api/pricing'
    },
    payment: {
      single: SINGLE_PRICE,
      batch: BATCH_BASE_PRICE,
      network: NETWORK,
      protocol: 'x402'
    }
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`nft-metadata-api listening on ${PORT}`);
  });
}

module.exports = app;
