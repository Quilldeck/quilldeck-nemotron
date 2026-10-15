
import AsyncStorage from '@react-native-async-storage/async-storage';

// Taoscope Labs receiving wallet
export const TAOSCOPE_WALLET = 'F9BCATy9pv5M8p14uwht5j4guY9gG9Da6ZYdvqJbiLr8';

// Devnet USDC mint
export const USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// Free tier limits
export const FREE_BLURB_LIMIT = 3;
export const FREE_MARKETING_LIMIT = 1;
export const FREE_METADATA_LIMIT = 1;

const STORAGE_KEY = 'quilldeck_subscription';

export interface SubscriptionState {
  tier: 'free' | 'pro';
  blurbsUsed: number;
  marketingUsed: number;
  metadataUsed: number;
  walletAddress?: string;
  txSignature?: string;
  proUnlockedAt?: string;
}

const defaultState: SubscriptionState = {
  tier: 'free',
  blurbsUsed: 0,
  marketingUsed: 0,
  metadataUsed: 0,
};

export async function getSubscription(): Promise<SubscriptionState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    // Merge over the defaults so state saved before a counter existed (e.g.
    // metadataUsed) reads as 0 rather than undefined -- undefined + 1 is NaN,
    // and NaN < limit is false, which would lock the feature on first use.
    return { ...defaultState, ...(JSON.parse(raw) as Partial<SubscriptionState>) };
  } catch {
    return defaultState;
  }
}

export async function saveSubscription(state: SubscriptionState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function incrementBlurbUsage(): Promise<SubscriptionState> {
  const state = await getSubscription();
  const updated = { ...state, blurbsUsed: state.blurbsUsed + 1 };
  await saveSubscription(updated);
  return updated;
}

export async function incrementMarketingUsage(): Promise<SubscriptionState> {
  const state = await getSubscription();
  const updated = { ...state, marketingUsed: state.marketingUsed + 1 };
  await saveSubscription(updated);
  return updated;
}

export async function incrementMetadataUsage(): Promise<SubscriptionState> {
  const state = await getSubscription();
  const updated = { ...state, metadataUsed: state.metadataUsed + 1 };
  await saveSubscription(updated);
  return updated;
}

export async function unlockPro(
  walletAddress: string,
  txSignature: string,
): Promise<SubscriptionState> {
  const state = await getSubscription();
  const updated: SubscriptionState = {
    ...state,
    tier: 'pro',
    walletAddress,
    txSignature,
    proUnlockedAt: new Date().toISOString(),
  };
  await saveSubscription(updated);
  return updated;
}

export async function canUseBlurb(): Promise<boolean> {
  const state = await getSubscription();
  if (state.tier === 'pro') return true;
  return state.blurbsUsed < FREE_BLURB_LIMIT;
}

export async function canUseMarketing(): Promise<boolean> {
  const state = await getSubscription();
  if (state.tier === 'pro') return true;
  return state.marketingUsed < FREE_MARKETING_LIMIT;
}

export async function canUseMetadata(): Promise<boolean> {
  const state = await getSubscription();
  if (state.tier === 'pro') return true;
  return state.metadataUsed < FREE_METADATA_LIMIT;
}
