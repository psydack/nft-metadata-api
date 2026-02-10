const HOST_BY_CHAIN = {
  1: 'eth-mainnet',
  8453: 'base-mainnet'
};

function normalizeContract(contract) {
  return String(contract || '').trim().toLowerCase();
}

function isValidContract(contract) {
  return /^0x[a-f0-9]{40}$/.test(contract);
}

function normalizeTokenId(tokenId) {
  return String(tokenId || '').trim().toLowerCase();
}

function isValidTokenId(tokenId) {
  return /^\d+$/.test(tokenId) || /^0x[0-9a-f]+$/.test(tokenId);
}

function toHexTokenId(tokenId) {
  const normalized = normalizeTokenId(tokenId);
  if (/^0x[0-9a-f]+$/.test(normalized)) {
    return normalized;
  }
  return `0x${BigInt(normalized).toString(16)}`;
}

function requestTimeoutSignal(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return controller.signal;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(`alchemy_error_${response.status}`);
    err.statusCode = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

function normalizeAttributes(attrs) {
  if (!Array.isArray(attrs)) {
    return [];
  }

  return attrs
    .map((item) => ({
      trait_type: String(item.trait_type || item.traitType || ''),
      value: item.value ?? null
    }))
    .filter((item) => item.trait_type);
}

function normalizeMedia(mediaArray) {
  const media = Array.isArray(mediaArray) ? mediaArray[0] : null;
  return {
    url: media?.gateway || media?.thumbnail || null,
    originalUrl: media?.raw || null,
    contentType: media?.format || null
  };
}

function normalizeTokenUri(tokenUri, contractAddress, tokenIdHex) {
  const raw = tokenUri?.raw || null;
  const gateway = tokenUri?.gateway || (raw && raw.startsWith('ipfs://')
    ? `https://ipfs.io/ipfs/${raw.replace('ipfs://', '')}`
    : (raw || `https://token-uri.g.alchemy.com/nft/v3/${contractAddress}/${tokenIdHex}`));

  return { raw, gateway };
}

function normalizeNftResult(chainId, contract, tokenIdInput, data, mode) {
  const metadata = data?.metadata || data?.raw?.metadata || {};
  const image = normalizeMedia(data?.media);

  const base = {
    chainId,
    contract,
    tokenId: String(tokenIdInput),
    name: data?.title || metadata?.name || null,
    description: metadata?.description || null,
    image,
    animation: {
      url: metadata?.animation_url || null,
      contentType: null
    },
    attributes: normalizeAttributes(metadata?.attributes),
    collection: {
      name: data?.contractMetadata?.name || null,
      slug: null,
      externalUrl: data?.contractMetadata?.openSea?.collectionSlug
        ? `https://opensea.io/collection/${data.contractMetadata.openSea.collectionSlug}`
        : null
    },
    tokenUri: normalizeTokenUri(data?.tokenUri, contract, toHexTokenId(tokenIdInput)),
    contractMetadata: {
      tokenType: data?.tokenType || data?.contractMetadata?.tokenType || null,
      symbol: data?.contractMetadata?.symbol || null
    },
    timeLastUpdated: data?.timeLastUpdated || null,
    spamInfo: {
      isSpam: data?.spamInfo?.isSpam ?? null,
      classifications: Array.isArray(data?.spamInfo?.classifications) ? data.spamInfo.classifications : []
    },
    errors: [],
    warnings: []
  };

  if (mode === 'full') {
    base.owners = Array.isArray(data?.owners) ? data.owners : [];
    base.mint = data?.mint || null;
  }

  return base;
}

async function fetchNftMetadata({ apiKey, chainId, contract, tokenId, refresh, timeoutMs, mode }) {
  const host = HOST_BY_CHAIN[chainId];
  if (!host) {
    throw new Error('unsupported_chain');
  }
  if (!apiKey) {
    throw new Error('missing_alchemy_key');
  }

  const tokenIdHex = toHexTokenId(tokenId);
  const params = new URLSearchParams({
    contractAddress: contract,
    tokenId: tokenIdHex,
    tokenType: 'ERC721'
  });

  if (refresh) {
    params.set('refreshCache', 'true');
  }
  if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
    params.set('tokenUriTimeoutInMs', String(timeoutMs));
  }

  const url = `https://${host}.g.alchemy.com/nft/v3/${apiKey}/getNFTMetadata?${params.toString()}`;
  const payload = await fetchJson(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: requestTimeoutSignal(timeoutMs)
  });

  return normalizeNftResult(chainId, contract, tokenId, payload, mode);
}

async function fetchNftMetadataBatch({ apiKey, chainId, tokens, refresh, timeoutMs, mode }) {
  const host = HOST_BY_CHAIN[chainId];
  if (!host) {
    throw new Error('unsupported_chain');
  }
  if (!apiKey) {
    throw new Error('missing_alchemy_key');
  }

  const batchUrl = `https://${host}.g.alchemy.com/nft/v3/${apiKey}/getNFTMetadataBatch`;
  const body = {
    tokens: tokens.map((t) => ({
      contractAddress: t.contract,
      tokenId: toHexTokenId(t.tokenId),
      tokenType: 'ERC721'
    })),
    refreshCache: !!refresh,
    tokenUriTimeoutInMs: Number.isFinite(timeoutMs) ? timeoutMs : 2000
  };

  try {
    const payload = await fetchJson(batchUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: requestTimeoutSignal(timeoutMs)
    });

    const rows = Array.isArray(payload?.nfts) ? payload.nfts : [];
    const byKey = new Map();
    for (const row of rows) {
      const c = normalizeContract(row?.contract?.address || row?.contractAddress || '');
      const t = normalizeTokenId(row?.tokenId || '');
      byKey.set(`${c}:${t}`, row);
    }

    return tokens.map((token) => {
      const keyDec = `${token.contract}:${normalizeTokenId(token.tokenId)}`;
      const keyHex = `${token.contract}:${toHexTokenId(token.tokenId)}`;
      const found = byKey.get(keyDec) || byKey.get(keyHex);
      if (!found) {
        return {
          chainId,
          contract: token.contract,
          tokenId: String(token.tokenId),
          errors: [{ code: 'TOKEN_NOT_FOUND', message: 'Token not found in batch response' }],
          warnings: []
        };
      }
      return normalizeNftResult(chainId, token.contract, token.tokenId, found, mode);
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode && statusCode !== 404 && statusCode !== 405) {
      throw error;
    }

    const results = [];
    for (const token of tokens) {
      try {
        const one = await fetchNftMetadata({ apiKey, chainId, contract: token.contract, tokenId: token.tokenId, refresh, timeoutMs, mode });
        results.push(one);
      } catch (inner) {
        results.push({
          chainId,
          contract: token.contract,
          tokenId: String(token.tokenId),
          errors: [{ code: 'ALCHEMY_UPSTREAM_ERROR', message: 'Failed to fetch metadata for token' }],
          warnings: []
        });
      }
    }

    return results;
  }
}

module.exports = {
  HOST_BY_CHAIN,
  normalizeContract,
  normalizeTokenId,
  isValidContract,
  isValidTokenId,
  toHexTokenId,
  fetchNftMetadata,
  fetchNftMetadataBatch,
  normalizeNftResult
};
