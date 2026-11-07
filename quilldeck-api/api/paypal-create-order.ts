import { guard } from '../lib/guard';
import { CATALOGUE, PayPalError, cleanText, isTierId, makeCustomId, paypalPost } from '../lib/paypal';

// Creates a PayPal (sandbox) order for a Quilldeck tier.
//
// Called when the author presses the PayPal button. The request carries the
// order the Launch Advisor drafted for this book:
//   { tier: "launch_pass", bookTitle: "...", draft: { itemName, itemDescription } }
// The draft supplies wording only. Price, currency, SKU and category always
// come from CATALOGUE on the server, so neither the AI nor the browser can
// change what the author is charged.
//
// Response: { id } - the PayPal order ID the checkout window needs.

export default async function handler(req: any, res: any) {
  if (!guard(req, res)) return;

  const { tier, bookTitle, draft } = req.body ?? {};
  if (!isTierId(tier)) {
    return res.status(400).json({ error: 'Unknown tier. Only the Launch Pass can be bought here.' });
  }
  const product = CATALOGUE[tier];

  const title = cleanText(bookTitle, 120);
  if (!title) {
    return res.status(400).json({ error: 'Please add the book title before buying a Launch Pass.' });
  }

  // Advisor wording, with a plain fallback if the draft is missing or empty.
  const itemName = cleanText(draft?.itemName, 120) || `${product.name}: ${title}`;
  const itemDescription =
    cleanText(draft?.itemDescription, 120) || `Launch Pass for ${title}: ${product.includes}.`;

  const order = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: product.sku,
        // Tier and book title, read back on capture to issue the pass.
        custom_id: makeCustomId(tier, title),
        description: cleanText(`${product.name} for ${title}`, 127),
        soft_descriptor: 'QUILLDECK',
        amount: {
          currency_code: product.currency,
          value: product.price,
          breakdown: { item_total: { currency_code: product.currency, value: product.price } },
        },
        items: [
          {
            name: itemName,
            description: itemDescription,
            sku: product.sku,
            category: 'DIGITAL_GOODS',
            quantity: '1',
            unit_amount: { currency_code: product.currency, value: product.price },
          },
        ],
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          // Shown to the buyer in the PayPal window instead of the sandbox
          // seller account's own name.
          brand_name: 'Quilldeck',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          locale: 'en-GB',
        },
      },
    },
  };

  try {
    const created = await paypalPost('/v2/checkout/orders', order);
    if (!created?.id) {
      return res.status(502).json({ error: 'PayPal did not return an order ID' });
    }
    return res.status(200).json({ id: created.id });
  } catch (error: any) {
    const status = error instanceof PayPalError ? error.status : 500;
    const detail = error instanceof PayPalError ? error.detail : String(error?.message ?? error);
    console.error('paypal-create-order failed:', error?.message, '|', detail);
    return res.status(status).json({ error: error?.message ?? 'Could not create the PayPal order' });
  }
}
