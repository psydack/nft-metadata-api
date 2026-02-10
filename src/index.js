require('dotenv').config();
const express = require('express');
const { paymentMiddleware } = require('@x402/express');
const { x402ResourceServer, HTTPFacilitatorClient } = require('@x402/core/server');
const { registerExactEvmScheme } = require('@x402/evm/exact/server');
const { fetchNftMetadata } = require('./alchemyService');

const app = express();
app.use(express.json());

const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PORT = process.env.APP_PORT || process.env.PORT || 3000;
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';
const NETWORK = process.env.NETWORK || 'eip155:84532';
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const PRICE = '$0.00025';

if (!WALLET_ADDRESS) {
  console.error('ERROR: WALLET_ADDRESS environment variable is required');
  process.exit(1);
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const x402Server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(x402Server);

app.use(paymentMiddleware({
  'POST /api/nft-metadata': {
    accepts: [{ scheme: 'exact', price: PRICE, network: NETWORK, payTo: WALLET_ADDRESS }],
    description: 'Fetch NFT metadata by chain, collection and tokenId',
    mimeType: 'application/json'
  }
}, x402Server));

app.post('/api/nft-metadata', async (req, res) => {
  try {
    const chainId = Number(req.body?.chainId);
    const contract = String(req.body?.contract || '').toLowerCase();
    const tokenId = String(req.body?.tokenId || '');

    if (!Number.isInteger(chainId) || !/^0x[a-f0-9]{40}$/.test(contract) || !/^\d+$/.test(tokenId)) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Provide chainId:number, contract:0x address, tokenId:numeric string'
      });
    }

    const metadata = await fetchNftMetadata({ apiKey: ALCHEMY_API_KEY, chainId, contract, tokenId });
    return res.json({ chainId, contract, tokenId, metadata });
  } catch (error) {
    const msg = String(error.message || error);
    if (msg.includes('missing_alchemy_key')) {
      return res.status(500).json({ error: 'CONFIG_ERROR', message: 'ALCHEMY_API_KEY is required' });
    }
    if (msg.includes('unsupported_chain')) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Unsupported chainId' });
    }
    return res.status(502).json({ error: 'UPSTREAM_ERROR', message: 'Failed to fetch NFT metadata', details: msg });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'NFT Metadata API',
    status: 'online',
    endpoint: 'POST /api/nft-metadata',
    example: { chainId: 1, contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', tokenId: '1' },
    payment: { price: PRICE, network: NETWORK, protocol: 'x402' }
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`nft-metadata-api listening on ${PORT}`);
  });
}

module.exports = app;
