// src/solanaPayment.ts
//
// Builds and sends a USDC transfer via Mobile Wallet Adapter, using classic
// web3.js types since that's what MWA's signAndSendTransactions expects.
// The rest of the app uses @solana/kit; this file intentionally does not.

import { transact, Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Connection, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

import { TAOSCOPE_WALLET, USDC_MINT_DEVNET } from './subscriptionService';

// Solana's own reference devnet endpoint -- spec-compliant, unlike some
// third-party proxies that returned responses @solana/web3.js rejected.
const DEVNET_RPC_URL = clusterApiUrl('devnet');

// Confirmed against the devnet USDC mint's own on-chain data: 6 decimals,
// classic Token Program (not Token-2022).
const USDC_DECIMALS = 6;

const APP_IDENTITY = {
  name: 'Quilldeck',
  uri: 'https://quilldeck.app',
  icon: 'favicon.ico',
};

export interface PaymentResult {
  walletAddress: string;
  txSignature: string;
}

function isMwaTimeout(error: any): boolean {
  const message = error?.message ?? '';
  const name = error?.name ?? '';
  return (
    name === 'SolanaMobileWalletAdapterError' ||
    message.includes('Timed out waiting for response')
  );
}

/**
 * Opens an MWA session, prompts the user to authorize and pay `amountUSDC`
 * in devnet USDC to the Taoscope receiving wallet, and returns the payer's
 * address and the transaction signature as soon as the wallet has signed
 * and submitted it.
 *
 * Deliberately does NOT wait for on-chain confirmation before returning.
 * The Android activity hosting this app can be backgrounded (and
 * occasionally killed/recreated) while switched to the wallet app, and a
 * multi-second confirmation poll here was exactly the kind of long-running
 * async work that risked getting cut off mid-flight -- silently losing the
 * Pro-unlock call even though the wallet had already submitted a valid
 * transaction. A signed transaction with a valid recent blockhash is
 * overwhelmingly likely to land; confirmation certainty isn't worth that
 * risk for this flow.
 */
export async function payWithSolana(amountUSDC: number): Promise<PaymentResult> {
  const connection = new Connection(DEVNET_RPC_URL, 'confirmed');
  const usdcMint = new PublicKey(USDC_MINT_DEVNET);
  const destinationOwner = new PublicKey(TAOSCOPE_WALLET);

  const {
    context: { slot: minContextSlot },
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext();

  const runSession = () =>
    transact(async (wallet: Web3MobileWallet) => {
      const authResult = await wallet.authorize({
        chain: 'solana:devnet',
        identity: APP_IDENTITY,
      });

      const payerPublicKey = new PublicKey(
        Buffer.from(authResult.accounts[0].address, 'base64')
      );

      const sourceAta = getAssociatedTokenAddressSync(usdcMint, payerPublicKey);
      const destinationAta = getAssociatedTokenAddressSync(usdcMint, destinationOwner);

      const amountInSmallestUnit = Math.round(amountUSDC * 10 ** USDC_DECIMALS);

      const transaction = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          payerPublicKey,
          destinationAta,
          destinationOwner,
          usdcMint,
        ),
        createTransferInstruction(
          sourceAta,
          destinationAta,
          payerPublicKey,
          amountInSmallestUnit,
        ),
      );

      transaction.recentBlockhash = blockhash;
      transaction.feePayer = payerPublicKey;

      const signatures = await wallet.signAndSendTransactions({
        transactions: [transaction],
        minContextSlot,
      });

      const txSignature = signatures[0];

      // No confirmTransaction() wait here -- return immediately so the
      // caller can persist the unlock before anything else has a chance
      // to interrupt the flow.
      return {
        walletAddress: payerPublicKey.toBase58(),
        txSignature,
      };
    });

  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await runSession();
    } catch (error: any) {
      lastError = error;
      if (!isMwaTimeout(error)) {
        throw error;
      }
      console.error(`MWA session timed out, retrying (attempt ${attempt + 1}/3)`);
    }
  }
  throw lastError;
}
