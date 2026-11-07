import { guard } from '../lib/guard';
import { CATALOGUE, PayPalError, paypalGet, paypalPost, readCustomId } from '../lib/paypal';
import { issuePass } from '../lib/entitlement';

// Captures an approved PayPal (sandbox) order, verifies it, and issues a
// signed Launch Pass for the book it was bought for.
//
// Request:  { orderId }
// Response: { pass, title, orderId, captureId, amount }   on success
//           { pending: true, reason }                     if PayPal holds the payment
//
// Nothing from the browser is trusted beyond the order ID. The tier, book title
// and amount are all read back from PayPal's own record of the order.

export default async function handler(req: any, res: any) {
  if (!guard(req, res)) return;

  const orderId = String(req.body?.orderId ?? '');
  if (!/^[A-Z0-9]{5,40}$/.test(orderId)) {
    return res.status(400).json({ error: 'Missing or malformed PayPal order ID' });
  }

  let order: any;
  try {
    order = await paypalPost(`/v2/checkout/orders/${orderId}/capture`);
  } catch (error: any) {
    // A page reload or double click can try to capture twice. The payment is
    // already safe, so read the order and carry on.
    if (error instanceof PayPalError && error.issue === 'ORDER_ALREADY_CAPTURED') {
      try {
        order = await paypalGet(`/v2/checkout/orders/${orderId}`);
      } catch (inner: any) {
        return fail(res, inner);
      }
    } else {
      return fail(res, error);
    }
  }

  const unit = order?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const bought = readCustomId(capture?.custom_id ?? unit?.custom_id);
  if (!bought) {
    console.error('paypal-capture: order is not a Quilldeck order', orderId);
    return res.status(400).json({ error: 'This PayPal order was not created by Quilldeck.' });
  }

  const product = CATALOGUE[bought.tier];
  const amount = capture?.amount;
  if (amount?.currency_code !== product.currency || amount?.value !== product.price) {
    console.error('paypal-capture: amount mismatch', orderId, amount);
    return res.status(400).json({ error: 'The amount paid does not match the Launch Pass price.' });
  }

  if (capture?.status === 'PENDING') {
    // In sandbox this usually means the seller account must accept a currency
    // it does not hold. No pass is issued until the money has really arrived.
    const reason = capture?.status_details?.reason ?? 'UNKNOWN';
    console.error('paypal-capture: capture pending', orderId, reason);
    return res.status(202).json({
      pending: true,
      reason,
      error: 'PayPal is holding this payment for review, so the Launch Pass is not active yet.',
    });
  }
  if (order?.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') {
    console.error('paypal-capture: not completed', orderId, order?.status, capture?.status);
    return res.status(402).json({ error: 'The payment did not complete. Nothing was charged.' });
  }

  const pass = issuePass({ tier: bought.tier, title: bought.title, orderId, captureId: capture.id });
  return res.status(200).json({
    pass,
    title: bought.title,
    orderId,
    captureId: capture.id,
    amount: `${amount.value} ${amount.currency_code}`,
  });
}

function fail(res: any, error: any) {
  const status = error instanceof PayPalError ? error.status : 500;
  const detail = error instanceof PayPalError ? error.detail : String(error?.message ?? error);
  console.error('paypal-capture failed:', error?.message, '|', detail);
  return res.status(status).json({ error: error?.message ?? 'Could not complete the PayPal payment' });
}
