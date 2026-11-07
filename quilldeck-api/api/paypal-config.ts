import { CATALOGUE, paywallEnabled } from '../lib/paypal';

// Tells the web page whether the Launch Pass checkout is switched on here, and
// gives it the PayPal Client ID (public by design: PayPal's browser SDK needs
// it). The Secret never leaves the server.
//
// Production (the live Nebius demo) answers { enabled: false }, so the page
// behaves exactly as before and every tool stays free.

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  if (!paywallEnabled()) return res.status(200).json({ enabled: false });
  const pass = CATALOGUE.launch_pass;
  return res.status(200).json({
    enabled: true,
    environment: 'sandbox',
    clientId: process.env.PAYPAL_CLIENT_ID,
    launchPass: { price: pass.price, currency: pass.currency, includes: pass.includes },
  });
}
