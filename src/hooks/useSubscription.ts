import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  getSubscription,
  canUseBlurb,
  canUseMarketing,
  canUseMetadata,
  incrementBlurbUsage,
  incrementMarketingUsage,
  incrementMetadataUsage,
  unlockPro,
  FREE_BLURB_LIMIT,
  FREE_MARKETING_LIMIT,
  FREE_METADATA_LIMIT,
  type SubscriptionState,
} from '../subscriptionService';

export function useSubscription() {
  const [subscription, setSubscription] = useState<SubscriptionState>({
    tier: 'free',
    blurbsUsed: 0,
    marketingUsed: 0,
    metadataUsed: 0,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const state = await getSubscription();
    setSubscription(state);
    setLoading(false);
  }, []);

  // Re-read on every focus, not just on mount: these screens stay mounted
  // under /subscription, so after a purchase the user comes back to a screen
  // whose isPro is stale. Refreshing on focus unlocks locked content at once.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const checkAndUseBlurb = useCallback(async (): Promise<boolean> => {
    const allowed = await canUseBlurb();
    if (!allowed) return false;
    const updated = await incrementBlurbUsage();
    setSubscription(updated);
    return true;
  }, []);

  const checkAndUseMarketing = useCallback(async (): Promise<boolean> => {
    const allowed = await canUseMarketing();
    if (!allowed) return false;
    const updated = await incrementMarketingUsage();
    setSubscription(updated);
    return true;
  }, []);

  const checkAndUseMetadata = useCallback(async (): Promise<boolean> => {
    const allowed = await canUseMetadata();
    if (!allowed) return false;
    const updated = await incrementMetadataUsage();
    setSubscription(updated);
    return true;
  }, []);

  const activatePro = useCallback(async (
    walletAddress: string,
    txSignature: string,
  ): Promise<void> => {
    const updated = await unlockPro(walletAddress, txSignature);
    setSubscription(updated);
  }, []);

  const isPro = subscription.tier === 'pro';
  const blurbsRemaining = isPro
    ? Infinity
    : Math.max(0, FREE_BLURB_LIMIT - subscription.blurbsUsed);
  const marketingRemaining = isPro
    ? Infinity
    : Math.max(0, FREE_MARKETING_LIMIT - subscription.marketingUsed);
  const metadataRemaining = isPro
    ? Infinity
    : Math.max(0, FREE_METADATA_LIMIT - subscription.metadataUsed);

  return {
    subscription,
    loading,
    isPro,
    blurbsRemaining,
    marketingRemaining,
    metadataRemaining,
    checkAndUseBlurb,
    checkAndUseMarketing,
    checkAndUseMetadata,
    activatePro,
    refresh,
  };
}