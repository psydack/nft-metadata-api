jest.mock('@x402/express', () => ({
  paymentMiddleware: () => (req, res, next) => next()
}));

const request = require('supertest');

process.env.ALCHEMY_API_KEY = 'test-key';
process.env.WALLET_ADDRESS = process.env.WALLET_ADDRESS || '0x3D491f06BebDc91A6d402f8d52a1B5210FD5a14A';
const app = require('../src/index');

describe('nft-metadata-api', () => {
  test('returns health', async () => {
    const response = await request(app).get('/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.body.service).toBe('nft-metadata-api');
  });

  test('validates unsupported chain', async () => {
    const response = await request(app).post('/api/nft-metadata').send({
      chainId: 56,
      contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      tokenId: '1'
    });

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('UNSUPPORTED_CHAIN');
  });

  test('returns normalized metadata for single request', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        title: 'Bored Ape #1',
        metadata: {
          description: 'desc',
          attributes: [{ trait_type: 'Eyes', value: 'Blue' }]
        },
        media: [{ gateway: 'https://img', raw: 'ipfs://img', format: 'image/png' }],
        tokenUri: { raw: 'ipfs://meta', gateway: 'https://gw/meta' },
        contractMetadata: { name: 'BAYC', symbol: 'BAYC', tokenType: 'ERC721' },
        spamInfo: { isSpam: false, classifications: [] },
        timeLastUpdated: '2026-02-10T00:00:00.000Z'
      })
    }));

    const response = await request(app).post('/api/nft-metadata').send({
      chainId: 1,
      contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      tokenId: '1',
      options: { mode: 'lite' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.chainId).toBe(1);
    expect(response.body.name).toBe('Bored Ape #1');
    expect(Array.isArray(response.body.attributes)).toBe(true);
    expect(response.body.image.url).toBe('https://img');

    global.fetch = originalFetch;
  });

  test('returns batch preserving order', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (_url, options) => {
      if (options && options.method === 'POST') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            nfts: [
              {
                contract: { address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d' },
                tokenId: '0x1',
                title: 'Ape 1',
                metadata: { attributes: [] },
                media: [],
                tokenUri: {},
                contractMetadata: { tokenType: 'ERC721', symbol: 'BAYC' },
                spamInfo: {}
              },
              {
                contract: { address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d' },
                tokenId: '0x2',
                title: 'Ape 2',
                metadata: { attributes: [] },
                media: [],
                tokenUri: {},
                contractMetadata: { tokenType: 'ERC721', symbol: 'BAYC' },
                spamInfo: {}
              }
            ]
          })
        };
      }
      return { ok: false, text: async () => '{}' };
    });

    const response = await request(app).post('/api/nft-metadata/batch').send({
      chainId: 1,
      tokens: [
        { contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', tokenId: '1' },
        { contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', tokenId: '2' }
      ],
      options: { mode: 'lite' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.count).toBe(2);
    expect(response.body.results[0].tokenId).toBe('1');
    expect(response.body.results[1].tokenId).toBe('2');

    global.fetch = originalFetch;
  });

  test('enforces batch token limit', async () => {
    const tokens = Array.from({ length: 101 }, (_, i) => ({
      contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      tokenId: String(i + 1)
    }));

    const response = await request(app).post('/api/nft-metadata/batch').send({ chainId: 1, tokens });
    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('TOKENS_LIMIT_EXCEEDED');
  });
});
