import { ReactNode, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';

import GenrePicker from '../components/GenrePicker';
import { GenreCategory, OTHER_GENRE_SENTINEL } from '../constants/genres';
import { AFROEUROFANTASY_GENRE, buildAfroeurofantasyPrimer } from '../constants/afroeurofantasy';
import { useSubscription } from '../src/hooks/useSubscription';

interface Metadata {
  categories: string[];
  keywords: string[];
  listing: { title: string; subtitle: string; bullets: string[] };
}

type SectionKey = 'categories' | 'keywords' | 'listing';

const SECTION_CONFIG: Record<SectionKey, { label: string; color: string; bg: string; icon: string; hint: string }> = {
  categories: { label: 'KDP CATEGORIES', color: '#E8A838', bg: '#2A1A00', icon: '🗂️', hint: 'KDP lets you pick 3 — choose the best fits from these 7.' },
  keywords: { label: 'KEYWORDS', color: '#14F195', bg: '#001A0F', icon: '🔑', hint: 'One per KDP keyword slot (7 slots, 50 characters each).' },
  listing: { label: 'LISTING PREVIEW', color: '#9945FF', bg: '#1A0A2A', icon: '📖', hint: 'Title, subtitle, and selling points for your product page.' },
};

export default function KdpMetadataScreen() {
  const router = useRouter();
  const { isPro, checkAndUseMetadata, metadataRemaining } = useSubscription();
  const [title, setTitle] = useState('');
  const [genreCategory, setGenreCategory] = useState<GenreCategory | ''>('');
  const [genre, setGenre] = useState('');
  const [customGenre, setCustomGenre] = useState('');
  const [africanTradition, setAfricanTradition] = useState('');
  const [europeanTradition, setEuropeanTradition] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<SectionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // The genre actually sent to the model -- swaps in the free-text value
  // when the author picked "Other" rather than sending the sentinel itself.
  const effectiveGenre = genre === OTHER_GENRE_SENTINEL ? customGenre.trim() : genre;

  const generateMetadata = async () => {
    if (!title.trim() || !genre.trim()) {
      setError('Add a book title and pick a genre first.');
      setErrorDetail(null);
      return;
    }

    if (genre === OTHER_GENRE_SENTINEL && !customGenre.trim()) {
      setError('Type in your genre, or pick one from the list instead.');
      setErrorDetail(null);
      return;
    }

    if (!isPro) {
      const allowed = await checkAndUseMetadata();
      if (!allowed) {
        router.push('/subscription');
        return;
      }
    }

    setLoading(true);
    setError(null);
    setErrorDetail(null);
    setMetadata(null);
    fadeAnim.setValue(0);
    try {
      // See constants/afroeurofantasy.ts -- the model needs grounding for the coined subgenre.
      const afroPrimer =
        genre === AFROEUROFANTASY_GENRE
          ? buildAfroeurofantasyPrimer(africanTradition, europeanTradition) + '\n\n'
          : '';

      const response = await fetch('https://quilldeck-api.vercel.app/api/generate-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${afroPrimer}You are an Amazon KDP metadata specialist for ${effectiveGenre} books.

Create KDP listing metadata for an indie author's book.

Book details:
- Title: "${title}"
- Genre: ${effectiveGenre}
- Synopsis: ${synopsis}

Requirements:
- categories: exactly 7 Amazon Kindle Store category paths that fit this book, most specific first, written as breadcrumb paths (e.g. "Kindle eBooks > Science Fiction & Fantasy > Fantasy > Epic")
- keywords: exactly 7 reader search phrases, one per KDP keyword slot, each under 50 characters. Do not repeat words from the title or the category names. No quotation marks, no competitor author names, no claims like "bestseller" or "free".
- listing.title: the book title as it should appear on the product page
- listing.subtitle: a short subtitle that signals genre and hook (under 100 characters)
- listing.bullets: 3 to 5 short selling points for the product page, drawn from the synopsis. No spoilers beyond Act 1.

Respond in this exact JSON format (no markdown, no backticks):
{"categories":["...","...","...","...","...","...","..."],"keywords":["...","...","...","...","...","...","..."],"listing":{"title":"...","subtitle":"...","bullets":["...","...","..."]}}`,
        }),
      });
      // The API reports failures as JSON, but a crash or gateway error can
      // still return HTML, so never assume the body parses.
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error ?? `The server returned an error (${response.status}).`);
        setErrorDetail(data?.detail ?? null);
        return;
      }

      if (!data?.categories?.length || !data?.keywords?.length || !data?.listing) {
        setError('The response came back without complete metadata.');
        return;
      }

      setMetadata(data);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    } catch (err: any) {
      setError("Couldn't reach the server. Check your connection and try again.");
      setErrorDetail(err?.message ?? null);
    } finally {
      setLoading(false);
    }
  };

  const sectionText = (key: SectionKey, data: Metadata): string => {
    if (key === 'categories') return data.categories.join('\n');
    if (key === 'keywords') return data.keywords.join('\n');
    const { title: t, subtitle, bullets } = data.listing;
    return [t, subtitle, '', ...bullets.map((b) => `• ${b}`)].join('\n');
  };

  const copySection = async (key: SectionKey) => {
    if (!metadata) return;
    await Clipboard.setStringAsync(sectionText(key, metadata));
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const renderCard = (key: SectionKey, body: ReactNode) => {
    const config = SECTION_CONFIG[key];
    return (
      <View key={key} style={[styles.resultCard, { backgroundColor: config.bg, borderColor: config.color }]}>
        <View style={styles.resultCardHeader}>
          <View style={[styles.sectionBadge, { borderColor: config.color }]}>
            <Text style={styles.sectionIcon}>{config.icon}</Text>
            <Text style={[styles.sectionLabel, { color: config.color }]}>{config.label}</Text>
          </View>
          <TouchableOpacity
            style={[styles.copyBtn, copied === key && styles.copyBtnSuccess]}
            onPress={() => copySection(key)}
          >
            <Text style={styles.copyBtnText}>{copied === key ? '✓ Copied' : 'Copy'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionHint}>{config.hint}</Text>
        {body}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>KDP Metadata Helper</Text>
            <Text style={styles.subtitle}>Categories, keywords and listing copy</Text>
          </View>
        </View>

        {!isPro && (
          <View style={styles.freeBanner}>
            <Text style={styles.freeBannerText}>
              Free trial · {metadataRemaining} generation{metadataRemaining === 1 ? '' : 's'} left
            </Text>
          </View>
        )}

        {/* Input Card */}
        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>Book Title</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. The Silent One"
            placeholderTextColor="#555577"
            value={title}
            onChangeText={setTitle}
          />

          <GenrePicker
            category={genreCategory}
            genre={genre}
            onChange={(cat, g) => { setGenreCategory(cat); setGenre(g); }}
            customGenre={customGenre}
            onCustomGenreChange={setCustomGenre}
            africanTradition={africanTradition}
            onAfricanTraditionChange={setAfricanTradition}
            europeanTradition={europeanTradition}
            onEuropeanTraditionChange={setEuropeanTradition}
          />
          <Text style={styles.inputLabel}>Synopsis</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            placeholder="Brief synopsis (2-3 sentences). Include character names and world details for best results."
            placeholderTextColor="#555577"
            value={synopsis}
            onChangeText={setSynopsis}
            multiline
            numberOfLines={4}
          />

          <TouchableOpacity
            style={[styles.generateBtn, loading && styles.generateBtnDisabled]}
            onPress={generateMetadata}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#0F0F1A" size="small" />
                <Text style={styles.generateBtnText}> Building your metadata...</Text>
              </View>
            ) : (
              <Text style={styles.generateBtnText}>🏷️ Generate Metadata</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>⚠ {error}</Text>
            {errorDetail ? <Text style={styles.errorDetail}>{errorDetail}</Text> : null}
            <TouchableOpacity
              style={styles.errorRetry}
              onPress={generateMetadata}
              activeOpacity={0.85}
            >
              <Text style={styles.errorRetryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Results */}
        {metadata && (
          <Animated.View style={[styles.results, { opacity: fadeAnim }]}>
            <Text style={styles.resultsHeader}>Your KDP Metadata</Text>

            {renderCard('categories', (
              <View style={styles.list}>
                {metadata.categories.map((c, i) => (
                  <Text key={i} style={styles.listItem}>{i + 1}. {c}</Text>
                ))}
              </View>
            ))}

            {renderCard('keywords', (
              <View style={styles.chipRow}>
                {metadata.keywords.map((k, i) => (
                  <View key={i} style={styles.chip}>
                    <Text style={styles.chipText}>{k}</Text>
                  </View>
                ))}
              </View>
            ))}

            {renderCard('listing', (
              <View style={styles.list}>
                <Text style={styles.listingTitle}>{metadata.listing.title}</Text>
                {metadata.listing.subtitle ? (
                  <Text style={styles.listingSubtitle}>{metadata.listing.subtitle}</Text>
                ) : null}
                {metadata.listing.bullets.map((b, i) => (
                  <Text key={i} style={styles.listItem}>• {b}</Text>
                ))}
              </View>
            ))}

            <TouchableOpacity
              style={styles.regenerateBtn}
              onPress={generateMetadata}
              activeOpacity={0.85}
            >
              <Text style={styles.regenerateBtnText}>↺ Generate Again</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
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

  freeBanner: { backgroundColor: '#0D0D1F', borderRadius: 10, borderWidth: 1, borderColor: '#1A1A3A', padding: 12, marginBottom: 20, alignItems: 'center' },
  freeBannerText: { fontSize: 12, color: '#9945FF', fontWeight: '500' },

  inputCard: { backgroundColor: '#1E1E32', borderRadius: 16, borderWidth: 1, borderColor: '#2A2A44', padding: 18, marginBottom: 24, gap: 10 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#8888AA', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: -4 },
  input: { backgroundColor: '#0F0F1A', borderRadius: 10, borderWidth: 1, borderColor: '#2A2A44', padding: 14, color: '#F5F5F5', fontSize: 15 },
  inputMulti: { minHeight: 100, textAlignVertical: 'top' },

  generateBtn: { backgroundColor: '#E8A838', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 6 },
  generateBtnDisabled: { opacity: 0.7 },
  generateBtnText: { color: '#0F0F1A', fontWeight: '800', fontSize: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },

  errorCard: { backgroundColor: '#2A0F14', borderRadius: 14, borderWidth: 1, borderColor: '#FF5C5C', padding: 16, marginBottom: 24, gap: 10 },
  errorTitle: { color: '#FF8A8A', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  errorDetail: { color: '#B06A6A', fontSize: 12, lineHeight: 17 },
  errorRetry: { alignSelf: 'flex-start', backgroundColor: '#3A1A1F', borderRadius: 8, borderWidth: 1, borderColor: '#FF5C5C', paddingHorizontal: 14, paddingVertical: 8 },
  errorRetryText: { color: '#FF8A8A', fontSize: 13, fontWeight: '700' },

  results: { gap: 16 },
  resultsHeader: { fontSize: 18, fontWeight: '800', color: '#F5F5F5', marginBottom: 4 },

  resultCard: { borderRadius: 16, borderWidth: 1.5, padding: 18, gap: 12 },
  resultCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  sectionIcon: { fontSize: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  sectionHint: { fontSize: 12, color: '#8888AA', lineHeight: 17, marginTop: -4 },

  list: { gap: 8 },
  listItem: { fontSize: 15, color: '#F5F5F5', lineHeight: 22 },
  listingTitle: { fontSize: 17, fontWeight: '800', color: '#F5F5F5' },
  listingSubtitle: { fontSize: 14, color: '#BBBBDD', fontStyle: 'italic', marginBottom: 4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#0F0F1A', borderRadius: 8, borderWidth: 1, borderColor: '#2A2A44', paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: '#F5F5F5', fontSize: 13 },

  copyBtn: { backgroundColor: '#2A2A44', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  copyBtnSuccess: { backgroundColor: '#1A3A1A' },
  copyBtnText: { color: '#F5F5F5', fontSize: 13, fontWeight: '600' },

  regenerateBtn: { backgroundColor: '#1E1E32', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A44', padding: 14, alignItems: 'center' },
  regenerateBtnText: { color: '#8888AA', fontWeight: '600', fontSize: 15 },
});
