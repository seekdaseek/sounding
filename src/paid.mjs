// paid.mjs — /paid/v1/exit: the same report as /v1/exit behind an x402 paywall on Stellar.
// Resource-server wiring follows stellar/x402-stellar examples/simple-paywall (payment.ts):
// @x402/express paymentMiddleware + x402ResourceServer + ExactStellarScheme + an HTTP facilitator.
// TESTNET ONLY here: network stellar:testnet, facilitator https://x402.org/facilitator
// (its /supported lists exact on stellar:testnet with fees sponsored; no key). Mainnet needs a
// receiving account and an OpenZeppelin mainnet key and is NOT configured.
import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { exitReport } from './read.mjs';
import { SIZES_USD } from './engine.mjs';

export const PAID_PATH = '/paid/v1/exit';

export function createPaidApp({ db, universe, payTo, network = 'stellar:testnet', facilitatorUrl = 'https://x402.org/facilitator', price = '$0.01', now = () => Date.now() }) {
  if (!/^G[A-Z2-7]{55}$/.test(payTo || '')) throw new Error('payTo must be a Stellar G... address');
  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(network, new ExactStellarScheme());
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.get('/paid/healthz', (_req, res) => res.json({ ok: true, network, facilitator: facilitatorUrl, price, payTo }));
  app.use(paymentMiddleware({
    [`GET ${PAID_PATH}`]: {
      accepts: [{ scheme: 'exact', price, network, payTo }],
      description: 'sounding exit-liquidity report for one asset and size (Stellar)',
    },
  }, server, undefined, undefined, true));
  const ids = new Map(universe.assets.map((a) => [a.id.toUpperCase(), a.id]));
  app.get(PAID_PATH, (req, res) => {
    const id = ids.get(String(req.query.asset || '').toUpperCase());
    if (!id) return res.status(400).json({ error: 'unknown asset', assets: [...ids.values()] });
    const size = Number(req.query.size ?? 100000);
    if (!Number.isFinite(size) || size < SIZES_USD[0] || size > SIZES_USD[SIZES_USD.length - 1]) return res.status(400).json({ error: 'size must be between 1000 and 1000000 (USD)' });
    res.json({ paid: true, network, ...exitReport(db, id, size, now()) });
  });
  return app;
}
