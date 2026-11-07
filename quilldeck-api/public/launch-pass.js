// Quilldeck Launch Pass: Launch Advisor (Nemotron) + PayPal checkout (sandbox).
//
// Flow, when the author asks for the launch plan without a pass for this book:
//   1. Launch Advisor: Nemotron reads the book and advises, honestly, whether
//      the Launch Pass is worth it now, and drafts the PayPal order line.
//   2. The author reviews the drafted order and pays with PayPal (JS SDK v6).
//   3. The server captures the payment, verifies it with PayPal and issues a
//      signed pass for this one book. The marketing endpoints check that pass.
//
// When /api/paypal-config says the checkout is off (the live production demo),
// none of this runs and the page behaves exactly as before.
(() => {
  'use strict';

  const STORE = 'quilldeck-pass-v1';
  const SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core';
  const $ = (id) => document.getElementById(id);
  // Must match normTitle() on the server.
  const norm = (t) => String(t || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120).toLowerCase();

  // ---- Config ----
  let config = { enabled: false };
  const configReady = fetch('/api/paypal-config', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .catch(() => ({ enabled: false }))
    .then((c) => {
      config = c || { enabled: false };
      if (config.enabled && $('goPlan')) $('goPlan').textContent = 'Build the launch plan (Launch Pass)';
      return config;
    });

  // ---- Stored pass (a convenience; the server checks the signature every time) ----
  let held = null;
  try { held = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) {}
  function save(v) {
    held = v;
    try { v ? localStorage.setItem(STORE, JSON.stringify(v)) : localStorage.removeItem(STORE); } catch (_) {}
  }

  async function ready(title) {
    const c = await configReady;
    if (!c.enabled) return true;
    return Boolean(held && held.pass && held.title === norm(title));
  }
  const headers = () => (held && held.pass ? { 'X-Quilldeck-Pass': held.pass } : {});
  const forget = () => save(null);

  // ---- Panel helpers ----
  const panel = () => $('passPanel');
  function message(text, kind) {
    const m = $('passMsg');
    m.textContent = text || '';
    m.className = `passmsg${kind ? ` ${kind}` : ''}${text ? '' : ' hidden'}`;
  }
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const money = (o) => `$${o.price} ${o.currency}`;

  // The order currently on offer: { title, itemName, itemDescription, tier }.
  let current = null;
  let onUnlocked = null;

  // ---- 1. Launch Advisor ----
  async function offer(book, blurb, unlocked) {
    onUnlocked = unlocked;
    current = null;
    const p = panel();
    p.classList.remove('hidden');
    $('passOrder').classList.add('hidden');
    $('passPay').classList.add('hidden');
    message('');
    const advice = $('passAdvice');
    advice.replaceChildren();
    const started = Date.now();
    const line = node('p', 'working', 'Nemotron is reading your book to advise you… 0s');
    advice.append(line);
    const tick = setInterval(() => {
      line.textContent = `Nemotron is reading your book to advise you… ${Math.round((Date.now() - started) / 1000)}s`;
    }, 1000);
    p.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

    let data;
    try {
      const res = await fetch('/api/launch-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: book.title, genre: book.genre, synopsis: book.synopsis,
          blurb: blurb || '', launch: book.launch || '', series: book.series || '',
        }),
      });
      data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.order) throw new Error((data && data.error) || `The advisor returned an error (${res.status}).`);
    } catch (err) {
      clearInterval(tick);
      advice.replaceChildren();
      message(`${err.message || 'The Launch Advisor could not be reached.'} Press "Build the launch plan" to try again.`, 'error');
      return;
    }
    clearInterval(tick);

    // Advice
    advice.replaceChildren();
    const free = data.recommendation === 'free';
    advice.append(node('p', `rec${free ? ' free' : ''}`, free ? 'Advice: the free tools are enough for now' : 'Recommended for this book: the Launch Pass'));
    advice.append(node('p', 'headline', data.headline));
    const list = node('ul', 'reasons');
    for (const r of data.reasons || []) list.append(node('li', null, r));
    advice.append(list);
    advice.append(node('p', 'byline', data.aiUsed
      ? 'Advice and order wording written by NVIDIA Nemotron for this book. The price is fixed by Quilldeck, not by the AI.'
      : 'Nemotron was busy, so this is Quilldeck\'s standard advice. The price is fixed by Quilldeck.'));

    // Drafted order
    current = { tier: data.order.tier, title: book.title, itemName: data.order.itemName, itemDescription: data.order.itemDescription };
    $('orderName').textContent = data.order.itemName;
    $('orderDesc').textContent = data.order.itemDescription;
    $('orderPrice').textContent = money(data.order);
    $('orderNote').textContent = free ? 'One-off, this book only. You can still buy it now if you prefer.' : 'One-off, this book only.';
    $('passOrder').classList.remove('hidden');

    // 2. PayPal
    try {
      await ensurePayPal();
      $('passPay').classList.remove('hidden');
    } catch (err) {
      message(`PayPal checkout could not load: ${err.message || err}`, 'error');
    }
  }

  // ---- 2. PayPal JS SDK v6 ----
  let sdkPromise = null;
  function ensurePayPal() {
    if (!sdkPromise) {
      sdkPromise = (async () => {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = SDK_URL;
          s.async = true;
          s.onload = resolve;
          s.onerror = () => reject(new Error('the PayPal script did not load'));
          document.head.append(s);
        });
        const sdk = await window.paypal.createInstance({
          clientId: config.clientId,
          components: ['paypal-payments'],
          pageType: 'checkout',
        });
        const methods = await sdk.findEligibleMethods({ currencyCode: config.launchPass ? config.launchPass.currency : 'USD' });
        if (!methods.isEligible('paypal')) throw new Error('PayPal is not available in this browser');
        const session = sdk.createPayPalOneTimePaymentSession({ onApprove, onCancel, onError });
        const button = $('paypal-button');
        button.removeAttribute('hidden');
        button.addEventListener('click', async () => {
          if (!current) return;
          message('');
          try {
            // Do not await createOrder before start(): the browser must still
            // treat the PayPal window as opened by the click.
            await session.start({ presentationMode: 'auto' }, createOrder(current));
          } catch (err) {
            message(`PayPal could not start: ${err.message || err}`, 'error');
          }
        });
      })();
      sdkPromise.catch(() => { sdkPromise = null; });
    }
    return sdkPromise;
  }

  async function createOrder(order) {
    const res = await fetch('/api/paypal-create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: order.tier,
        bookTitle: order.title,
        draft: { itemName: order.itemName, itemDescription: order.itemDescription },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.id) throw new Error((data && data.error) || 'Could not create the PayPal order');
    return { orderId: data.id };
  }

  // ---- 3. Capture, verify, unlock ----
  async function onApprove(data) {
    message('Confirming your payment with PayPal…');
    let res, body;
    try {
      res = await fetch('/api/paypal-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: data.orderId }),
      });
      body = await res.json().catch(() => null);
    } catch (_) {
      message('Could not reach the server to confirm the payment. Check your connection, then reload the page.', 'error');
      return;
    }
    if (res.status === 202 && body && body.pending) {
      message(`${body.error} (PayPal reason: ${body.reason}).`, 'error');
      return;
    }
    if (!res.ok || !body || !body.pass) {
      message((body && body.error) || 'The payment could not be confirmed.', 'error');
      return;
    }
    save({ title: norm(body.title), pass: body.pass, orderId: body.orderId, captureId: body.captureId });
    $('passPay').classList.add('hidden');
    message(`Payment received: ${body.amount}, PayPal sandbox. Your Launch Pass for "${body.title}" is active. Building your launch plan now…`, 'ok');
    setTimeout(() => {
      panel().classList.add('hidden');
      message('');
      if (typeof onUnlocked === 'function') onUnlocked();
    }, 2200);
  }

  function onCancel() {
    message('Checkout closed. Nothing was charged.');
  }

  function onError(err) {
    message(`PayPal reported a problem: ${(err && err.message) || err}. Nothing was charged.`, 'error');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const close = $('passClose');
    if (close) close.addEventListener('click', () => { panel().classList.add('hidden'); message(''); });
  });

  window.QuilldeckPass = { ready, headers, forget, offer };
})();
