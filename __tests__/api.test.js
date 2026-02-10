jest.mock('@x402/express', () => ({
  paymentMiddleware: () => (req, res, next) => next()
}));

const request = require('supertest');

process.env.ALCHEMY_API_KEY = 'test-key';
const app = require('../src/index');

describe('nft-metadata-api', () => {
  test('returns 400 on invalid input', async () => {
    const response = await request(app).post('/api/nft-metadata').send({ chainId: 'x' });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('BAD_REQUEST');
  });

  test('returns metadata for valid request', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ tokenUri: 'ipfs://abc', name: 'NFT #1' })
    }));

    const response = await request(app).post('/api/nft-metadata').send({
      chainId: 1,
      contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      tokenId: '1'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.metadata.name).toBe('NFT #1');

    global.fetch = originalFetch;
  });
});
