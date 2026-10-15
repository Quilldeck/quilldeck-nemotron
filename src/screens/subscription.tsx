import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { payWithSolana } from '../solanaPayment';
import { unlockPro } from '../subscriptionService';

// Pricing mirrors pitch deck Slide 5. USDC is the anchor price; the card
// price is derived from it so the "15% off with USDC" promise always holds.
const USDC_DISCOUNT = 0.15;
const cardPriceFor = (usdc: number) => Math.round((usdc / (1 - USDC_DISCOUNT)) * 100) / 100;

type TierId = 'free' | 'launch' | 'pro-annual' | 'publisher';
type Billing = 'monthly' | 'yearly';

interface PriceOption {
  usdc: number;
  period: string;
}

// `soon: true` marks a promised feature that isn't built yet, so the card
// can show it honestly with a "Coming soon" tag rather than over-promising.
interface Feature {
  text: string;
  soon?: boolean;
}

interface Tier {
  id: TierId;
  name: string;
  description: string;
  color: string;
  features: Feature[];
  // Publisher License is the only tier with a monthly/yearly choice.
  prices: { default: PriceOption } | Record<Billing, PriceOption>;
}

// NOTE: "per launch" / "1 book" / "per year" are display copy only for now.
// Any paid purchase still calls unlockPro(), which flips one device-wide
// "pro" flag and unlocks everything indefinitely. Real per-book entitlements
// and tier expiry are a known post-hackathon item.
const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Basic AI blurb generation',
    color: '#8888AA',
    prices: { default: { usdc: 0, period: 'forever' } },
    features: [
      { text: 'Basic AI blurb generation' },
      { text: 'Try Go Market This and KDP Metadata Helper once' },
    ],
  },
  {
    id: 'launch',
    name: 'Launch Pass',
    description: '1 book. 14-day posting calendar + complete marketing package.',
    color: '#14F195',
    prices: { default: { usdc: 59, period: 'per launch' } },
    features: [
      { text: '1 book' },
      { text: '14-day posting calendar' },
      { text: 'Complete marketing package (Go Market This)' },
      { text: 'All 3 AI blurb variants' },
      { text: 'KDP Metadata Helper' },
    ],
  },
  {
    id: 'pro-annual',
    name: 'Pro Annual',
    description: '90-day rolling calendar. Multiple backlists + priority access.',
    color: '#9945FF',
    prices: { default: { usdc: 149, period: 'per year' } },
    features: [
      { text: 'Everything in Launch Pass' },
      { text: '90-day rolling calendar', soon: true },
      { text: 'Multiple backlists', soon: true },
      { text: 'Priority access', soon: true },
    ],
  },
  {
    id: 'publisher',
    name: 'Publisher License',
    description: 'Start your own marketing agency.',
    color: '#E8A838',
    prices: {
      monthly: { usdc: 299, period: 'per month' },
      yearly: { usdc: 2499, period: 'per year' },
    },
    features: [
      { text: 'Everything in Pro Annual' },
      { text: '365-day calendar', soon: true },
      { text: 'White-labelled exports', soon: true },
      { text: 'Clients never touch the dashboard', soon: true },
    ],
  },
];

function priceFor(tier: Tier, billing: Billing): PriceOption {
  return 'default' in tier.prices ? tier.prices.default : tier.prices[billing];
}

// $69.41, $2,940 -- whole amounts drop the cents, everything gets commas.
function formatUSD(amount: number): string {
  const fixed = Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
  const [whole, cents] = fixed.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${cents ? `${withCommas}.${cents}` : withCommas}`;
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const [selectedTier, setSelectedTier] = useState<TierId>('launch');
  const [publisherBilling, setPublisherBilling] = useState<Billing>('monthly');
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [useCrypto, setUseCrypto] = useState(true);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const selected = TIERS.find(t => t.id === selectedTier)!;
  const selectedPrice = priceFor(selected, publisherBilling);
  const selectedCard = cardPriceFor(selectedPrice.usdc);
  const isFree = selected.id === 'free';

  const handlePayment = async () => {
    if (isFree) {
      router.back();
      return;
    }

    if (!useCrypto) {
      Alert.alert('Coming soon', 'Card payment isn\'t available yet — pay with Solana for now.');
      return;
    }

    setPaying(true);
    setPaymentError(null);

    try {
      const result = await payWithSolana(selectedPrice.usdc);
      await unlockPro(result.walletAddress, result.txSignature);
      setTxSignature(result.txSignature);
      setPaid(true);
    } catch (err: any) {
      console.error('Payment failed:', err);
      setPaymentError(err?.message ?? 'Payment failed. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  if (paid) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.successScreen}>
          <Text style={styles.successIcon}>✦</Text>
          <Text style={styles.successTitle}>Welcome to {selected.name}</Text>
          <Text style={styles.successSub}>
            Your payment was confirmed on Solana.{'\n'}
            Time to get your book in front of readers.
          </Text>
          <View style={styles.txCard}>
            <Text style={styles.txLabel}>Transaction confirmed</Text>
            <Text style={styles.txHash}>
              {txSignature ? `${txSignature.slice(0, 8)}...${txSignature.slice(-8)}` : ''}
            </Text>
            <Text style={styles.txNetwork}>Solana Devnet · USDC</Text>
          </View>
          <TouchableOpacity style={styles.successBtn} onPress={() => router.back()}>
            <Text style={styles.successBtnText}>Start Publishing →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>Plans & Pricing</Text>
            <Text style={styles.subtitle}>Per launch, yearly or monthly. No hidden fees.</Text>
          </View>
        </View>

        {/* Crypto Toggle */}
        <View style={styles.cryptoToggle}>
          <TouchableOpacity
            style={[styles.toggleOption, useCrypto && styles.toggleOptionActive]}
            onPress={() => setUseCrypto(true)}
          >
            <Text style={[styles.toggleText, useCrypto && styles.toggleTextActive]}>
              ◎ Pay with USDC
            </Text>
            {useCrypto && (
              <View style={styles.discountBadge}>
                <Text style={styles.discountText}>15% OFF</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleOption, !useCrypto && styles.toggleOptionActiveStd]}
            onPress={() => setUseCrypto(false)}
          >
            <Text style={[styles.toggleText, !useCrypto && styles.toggleTextActive]}>
              💳 Standard
            </Text>
          </TouchableOpacity>
        </View>

        {useCrypto && (
          <View style={styles.cryptoInfo}>
            <Text style={styles.cryptoInfoText}>
              ◎ Zero platform commission · Devnet USDC · Seed Vault secured
            </Text>
          </View>
        )}

        {/* Tier Cards */}
        <View style={styles.tiers}>
          {TIERS.map((tier) => {
            const price = priceFor(tier, publisherBilling);
            const card = cardPriceFor(price.usdc);
            const tierIsFree = price.usdc === 0;
            return (
              <TouchableOpacity
                key={tier.id}
                style={[
                  styles.tierCard,
                  { borderColor: selectedTier === tier.id ? tier.color : '#2A2A44' },
                  selectedTier === tier.id && styles.tierCardSelected,
                ]}
                onPress={() => setSelectedTier(tier.id)}
                activeOpacity={0.85}
              >
                <View style={styles.tierHeader}>
                  <View style={styles.tierTitleBlock}>
                    <Text style={[styles.tierName, { color: tier.color }]}>{tier.name}</Text>
                    <Text style={styles.tierDesc}>{tier.description}</Text>
                  </View>
                  <View style={styles.tierPricing}>
                    <Text style={styles.tierPrice}>
                      {tierIsFree
                        ? '$0'
                        : useCrypto
                          ? `${formatUSD(price.usdc)} USDC`
                          : formatUSD(card)}
                    </Text>
                    <Text style={styles.tierPeriod}>{price.period}</Text>
                    {useCrypto && !tierIsFree && (
                      <Text style={styles.tierOriginal}>{formatUSD(card)}</Text>
                    )}
                  </View>
                </View>

                {'monthly' in tier.prices && (
                  <View style={styles.billingToggle}>
                    {(['monthly', 'yearly'] as Billing[]).map((b) => (
                      <TouchableOpacity
                        key={b}
                        style={[
                          styles.billingOption,
                          publisherBilling === b && { backgroundColor: tier.color },
                        ]}
                        onPress={() => { setPublisherBilling(b); setSelectedTier(tier.id); }}
                      >
                        <Text style={[styles.billingText, publisherBilling === b && styles.billingTextActive]}>
                          {b === 'monthly' ? 'Monthly' : 'Yearly'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <View style={styles.tierFeatures}>
                  {tier.features.map((f, i) => (
                    <View key={i} style={styles.featureRow}>
                      <Text style={[styles.featureCheck, { color: tier.color }]}>✓</Text>
                      <Text style={styles.featureText}>
                        {f.text}
                        {f.soon ? (
                          <Text style={styles.soonTag}>{'  '}COMING SOON</Text>
                        ) : null}
                      </Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Error */}
        {paymentError && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>⚠ {paymentError}</Text>
          </View>
        )}

        {/* Payment Button */}
        <View style={styles.paymentSection}>
          <View style={styles.paymentSummary}>
            <Text style={styles.paymentSummaryText}>
              {selected.name} · {isFree
                ? '$0'
                : useCrypto
                  ? `${formatUSD(selectedPrice.usdc)} USDC`
                  : formatUSD(selectedCard)}
              {isFree ? '' : ` ${selectedPrice.period}`}
            </Text>
            {useCrypto && !isFree && (
              <Text style={styles.paymentSaving}>
                You save {formatUSD(Math.round((selectedCard - selectedPrice.usdc) * 100) / 100)}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.payBtn, { backgroundColor: selected.color }, paying && styles.payBtnDisabled]}
            onPress={handlePayment}
            disabled={paying}
            activeOpacity={0.85}
          >
            {paying ? (
              <View style={styles.payingRow}>
                <ActivityIndicator color="#0F0F1A" size="small" />
                <Text style={styles.payBtnText}> Confirming on Solana...</Text>
              </View>
            ) : (
              <Text style={styles.payBtnText}>
                {isFree
                  ? 'Continue with Free'
                  : `${useCrypto ? '◎ Pay with Solana' : '💳 Pay Now'} · ${selected.name}`}
              </Text>
            )}
          </TouchableOpacity>

          {useCrypto && !isFree && (
            <Text style={styles.payNote}>
              Secured by Seed Vault · Zero platform commission
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0F0F1A' },
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#1E1E32', alignItems: 'center', justifyContent: 'center' },
  backArrow: { fontSize: 18, color: '#E8A838' },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: '800', color: '#F5F5F5' },
  subtitle: { fontSize: 13, color: '#8888AA', marginTop: 2 },

  cryptoToggle: { flexDirection: 'row', backgroundColor: '#1E1E32', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A44', padding: 4, marginBottom: 12, gap: 4 },
  toggleOption: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  toggleOptionActive: { backgroundColor: '#9945FF' },
  toggleOptionActiveStd: { backgroundColor: '#2A2A44' },
  toggleText: { fontSize: 13, color: '#8888AA', fontWeight: '600' },
  toggleTextActive: { color: '#F5F5F5' },
  discountBadge: { backgroundColor: '#14F195', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  discountText: { fontSize: 10, color: '#0F0F1A', fontWeight: '800' },

  cryptoInfo: { backgroundColor: '#0D0D1F', borderRadius: 10, borderWidth: 1, borderColor: '#1A1A3A', padding: 12, marginBottom: 20, alignItems: 'center' },
  cryptoInfoText: { fontSize: 12, color: '#9945FF', fontWeight: '500' },

  tiers: { gap: 14, marginBottom: 24 },
  tierCard: { backgroundColor: '#1E1E32', borderRadius: 16, borderWidth: 1.5, padding: 18, gap: 14 },
  tierCardSelected: { backgroundColor: '#1A1A2E' },
  tierHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  tierTitleBlock: { flex: 1 },
  tierName: { fontSize: 18, fontWeight: '800' },
  tierDesc: { fontSize: 12, color: '#8888AA', marginTop: 2 },
  tierPricing: { alignItems: 'flex-end' },
  tierPrice: { fontSize: 16, fontWeight: '800', color: '#F5F5F5' },
  tierPeriod: { fontSize: 11, color: '#8888AA' },
  tierOriginal: { fontSize: 11, color: '#555577', textDecorationLine: 'line-through' },
  billingToggle: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: '#0F0F1A', borderRadius: 8, borderWidth: 1, borderColor: '#2A2A44', padding: 3, gap: 3 },
  billingOption: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  billingText: { fontSize: 12, color: '#8888AA', fontWeight: '700' },
  billingTextActive: { color: '#0F0F1A' },
  tierFeatures: { gap: 8 },
  featureRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  featureCheck: { fontSize: 13, fontWeight: '700', marginTop: 1 },
  featureText: { fontSize: 13, color: '#8888AA', flex: 1, lineHeight: 18 },
  soonTag: { fontSize: 10, fontWeight: '700', color: '#6E6E99', letterSpacing: 0.5 },

  errorCard: { backgroundColor: '#2A0F14', borderRadius: 14, borderWidth: 1, borderColor: '#FF5C5C', padding: 16, marginBottom: 16 },
  errorTitle: { color: '#FF8A8A', fontSize: 13, fontWeight: '600', lineHeight: 19 },

  paymentSection: { gap: 12 },
  paymentSummary: { backgroundColor: '#1E1E32', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A44', padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paymentSummaryText: { fontSize: 15, color: '#F5F5F5', fontWeight: '700' },
  paymentSaving: { fontSize: 13, color: '#14F195', fontWeight: '600' },
  payBtn: { borderRadius: 14, padding: 18, alignItems: 'center' },
  payBtnDisabled: { opacity: 0.7 },
  payBtnText: { color: '#0F0F1A', fontWeight: '800', fontSize: 16 },
  payingRow: { flexDirection: 'row', alignItems: 'center' },
  payNote: { textAlign: 'center', fontSize: 12, color: '#555577' },

  successScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  successIcon: { fontSize: 48, color: '#E8A838' },
  successTitle: { fontSize: 28, fontWeight: '800', color: '#F5F5F5', textAlign: 'center' },
  successSub: { fontSize: 15, color: '#8888AA', textAlign: 'center', lineHeight: 22 },
  txCard: { backgroundColor: '#1E1E32', borderRadius: 14, borderWidth: 1, borderColor: '#2A2A44', padding: 18, width: '100%', gap: 8, alignItems: 'center' },
  txLabel: { fontSize: 12, color: '#8888AA', fontWeight: '600' },
  txHash: { fontSize: 13, color: '#14F195', fontWeight: '700' },
  txNetwork: { fontSize: 12, color: '#9945FF' },
  successBtn: { backgroundColor: '#E8A838', borderRadius: 14, padding: 18, width: '100%', alignItems: 'center' },
  successBtnText: { color: '#0F0F1A', fontWeight: '800', fontSize: 16 },
});


