# Quilldeck

**The AI-powered mobile publishing and marketing toolkit for independent authors, built for Solana Seeker.**

> Your book deserves a fighting chance.

Submission for [CLOCK IN: The Solana Mobile Hackathon](https://solanamobile.com/hackathon).

---

## What it does

Authors write their books elsewhere. Quilldeck picks up when the manuscript is done: it writes the blurb, prepares the KDP listing, and builds the launch plan, all from a phone.

It is not a writing tool, an editor or a formatting tool.

### Features (all working in the submitted APK)

- **AI Blurb Generator**: enter a title, genre and synopsis and get three genre-aware blurb variants (emotional, action and mystery hooks), ready to paste into KDP.
- **Go Market This**: one tap generates a full launch package: social posts, pre-launch, launch-day and post-launch emails, Amazon ad copy with keywords, and a 14-day posting calendar.
- **KDP Metadata Helper**: 7 categories, 7 keywords, and a listing preview (title, subtitle and selling points).
- **Pay with USDC on Solana**: unlock the full toolkit with a Launch Pass ($59 USDC per book). Payment goes through Solana Pay, signed via Mobile Wallet Adapter.

### Free tier and paywall

| Tier | What you get |
|---|---|
| Free | 3 blurb generations (1 of 3 variants shown), Day 1 of the 14-day plan, 1 KDP Metadata generation |
| Launch Pass ($59 USDC / book) | All 3 blurb variants, full 14-day calendar and marketing package, KDP Metadata Helper |
| Pro Annual / Publisher License | Shown in the app as "Coming soon" |

## Solana integration

- **Mobile Wallet Adapter**: `@solana-mobile/mobile-wallet-adapter-protocol-web3js`. The app opens the user's wallet to authorize and sign the payment (`src/solanaPayment.ts`).
- **Solana Pay with USDC**: SPL-token transfer built with `@solana/web3.js` and `@solana/spl-token`.
- **Seeker**: on a Seeker, signing keys are held in Seed Vault by the wallet.
- **Network**: **devnet only** in this build. Payments use devnet USDC (mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). No real funds move.

## Install the APK

1. Download `quilldeck-release.apk` from the [Releases page](https://github.com/Quilldeck/quilldeck/releases).
2. On your Android device or Seeker, allow installs from this source when prompted.
3. Open the APK to install it, then launch Quilldeck.

To test the purchase you need a Solana wallet app on the device funded with devnet SOL (for fees) and at least 59 devnet USDC (from [faucet.circle.com](https://faucet.circle.com)).

## Tech stack

| Layer | Technology |
|---|---|
| App | React Native (Expo SDK 55, Expo Router) |
| Solana | Mobile Wallet Adapter, Solana Pay, @solana/web3.js, @solana/spl-token |
| Backend | Vercel serverless functions (`quilldeck-api`) |
| AI | Groq API (Llama 3.3 70B) |
| Target hardware | Solana Seeker (Android) |

## Build from source

```bash
npm install
npx expo run:android --variant release   # standalone release build on a connected device
```

The backend lives in `quilldeck-api` and is deployed on Vercel. Running your own copy needs a Groq API key set as `GROQ_API_KEY` in the Vercel environment. The app points at the hosted backend by default.

## Known limitations (hackathon build)

- Payments are on **devnet**. Mainnet is the next step.
- The unlock status is stored on the device. There is no server-side entitlement or account system yet, so a purchase unlocks the whole toolkit on that device.
- Pro Annual and Publisher License tiers are not built and are marked "Coming soon".
- Book details are entered separately in each tool. Entering them once and sharing them across tools is the top post-hackathon priority.

## Project structure

```
quilldeck/
├── app/             # Expo Router screens
├── components/      # Shared UI components
├── constants/       # Design tokens, config, genres
├── src/             # Payments, subscription state, hooks
└── quilldeck-api/   # Vercel serverless backend
```

## About

Built solo by [Phoenix F. Black](https://quilldeck.app), author, publisher and CEO of Taoscope Labs Ltd, founder of [Iroko Tree Press](https://www.irokotreepress.com). Quilldeck is the tool he needed while launching his own book.

- Web: [quilldeck.app](https://quilldeck.app)
- X: [@quilldeck0](https://x.com/quilldeck0)

## License

MIT