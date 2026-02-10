const HOST_BY_CHAIN = {
  1: 'eth-mainnet',
  8453: 'base-mainnet',
  84532: 'base-sepolia'
};

function toHexTokenId(tokenId) {
  return `0x${BigInt(tokenId).toString(16)}`;
}

async function fetchNftMetadata({ apiKey, chainId, contract, tokenId }) {
  const host = HOST_BY_CHAIN[chainId];
  if (!host) {
    throw new Error('unsupported_chain');
  }
  if (!apiKey) {
    throw new Error('missing_alchemy_key');
  }

  const hexTokenId = toHexTokenId(tokenId);
  const params = new URLSearchParams({
    contractAddress: contract,
    tokenId: hexTokenId,
    tokenType: 'ERC721'
  });

  const url = `https://${host}.g.alchemy.com/nft/v3/${apiKey}/getNFTMetadata?${params.toString()}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`alchemy_error_${response.status}:${text.slice(0, 200)}`);
  }

  return response.json();
}

module.exports = {
  HOST_BY_CHAIN,
  fetchNftMetadata
};
