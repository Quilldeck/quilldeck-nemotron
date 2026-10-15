import { useRef, useState } from 'react';
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

interface Blurb {
  variant: number;
  hook: string;
  text: string;
}

const HOOK_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  emotional: { label: 'EMOTIONAL HOOK', color: '#E8A838', bg: '#2A1A00', icon: '❤️' },
  action: { label: 'ACTION HOOK', color: '#14F195', bg: '#001A0F', icon: '⚡' },
  mystery: { label: 'MYSTERY HOOK', color: '#9945FF', bg: '#1A0A2A', icon: '🔮' },
};

export default function BlurbGeneratorScreen() {
  const router = useRouter();
  const { isPro, checkAndUseBlurb, blurbsRemaining } = useSubscription();
  const [title, setTitle] = useState('');
  const [genreCategory, setGenreCategory] = useState<GenreCategory | ''>('');
  const [genre, setGenre] = useState('');
  const [customGenre, setCustomGenre] = useState('');
  const [africanTradition, setAfricanTradition] = useState('');
  const [europeanTradition, setEuropeanTradition] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [blurbs, setBlurbs] = useState<Blurb[]>([]);
  const [loading, setLoading] = useState(false);
  const [showGenres, setShowGenres] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // The genre actually sent to the model -- swaps in the free-text value
  // when the author picked "Other" rather than sending the sentinel itself.
  const effectiveGenre = genre === OTHER_GENRE_SENTINEL ? customGenre.trim() : genre;

  const generateBlurbs = async () => {
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
      const allowed = await checkAndUseBlurb();
      if (!allowed) {
        router.push('/subscription');
        return;
      }
    }

    setLoading(true);
    setError(null);
    setErrorDetail(null);
    setBlurbs([]);
    try {
      // Afroeurofantasy is a coined subgenre the model has never seen in
      // training, so it needs an explicit primer grounding it in the real
      // definitional rules -- otherwise it defaults to generic "African
      // magic meets European magic" copy. See constants/afroeurofantasy.ts.
      const afroPrimer =
        genre === AFROEUROFANTASY_GENRE
          ? buildAfroeurofantasyPrimer(africanTradition, europeanTradition) + '\n\n'
          : '';

      const response = await fetch('https://quilldeck-api.vercel.app/api/generate-blurb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${afroPrimer}You are a professional book marketing copywriter specialising in ${effectiveGenre} fiction.

Generate exactly 3 different book blurbs for an indie author's novel. Each blurb should use a different hook strategy:
1. EMOTIONAL HOOK — Lead with the character's emotional stakes
2. ACTION HOOK — Lead with the inciting incident or central conflict
3. MYSTERY HOOK — Lead with an intriguing question or enigma

Book details:
- Title: "${title}"
- Genre: ${effectiveGenre}
- Synopsis: ${synopsis}

Requirements for EACH blurb:
- 150-200 words (Amazon optimal length)
- End with a compelling call-to-action line
- Include genre-appropriate tone and language
- Be ready to paste directly into KDP
- No spoilers beyond Act 1
- Use the actual character names and world details from the synopsis

Respond in this exact JSON format (no markdown, no backticks):
{"blurbs":[{"variant":1,"hook":"emotional","text":"Full blurb text here..."},{"variant":2,"hook":"action","text":"Full blurb text here..."},{"variant":3,"hook":"mystery","text":"Full blurb text here..."}]}`,
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

      if (!data?.blurbs?.length) {
        setError('The response came back without any blurbs.');
        return;
      }

      setBlurbs(data.blurbs);
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

  const copyBlurb = async (text: string, variant: number) => {
    await Clipboard.setStringAsync(text);
    setCopied(variant);
    setTimeout(() => setCopied(null), 2000);
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
            <Text style={styles.title}>AI Blurb Generator</Text>
            <Text style={styles.subtitle}>3 professional blurbs from your synopsis</Text>
          </View>
        </View>

        {!isPro && (
          <View style={styles.freeBanner}>
            <Text style={styles.freeBannerText}>
              Free trial · {blurbsRemaining} generation{blurbsRemaining === 1 ? '' : 's'} left · 1 of 3 variants shown per generation
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
            onPress={generateBlurbs}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#0F0F1A" size="small" />
                <Text style={styles.generateBtnText}> Crafting your blurbs...</Text>
              </View>
            ) : (
              <Text style={styles.generateBtnText}>✨ Generate Blurbs</Text>
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
              onPress={generateBlurbs}
              activeOpacity={0.85}
            >
              <Text style={styles.errorRetryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Results */}
        {blurbs.length > 0 && (
          <Animated.View style={[styles.results, { opacity: fadeAnim }]}>
            <Text style={styles.resultsHeader}>Your 3 Blurbs</Text>
            {blurbs.map((blurb, idx) => {
              const config = HOOK_CONFIG[blurb.hook] || HOOK_CONFIG.emotional;
              const locked = !isPro && idx > 0;

              if (locked) {
                return (
                  <View key={blurb.variant} style={styles.lockedCard}>
                    <Text style={styles.lockedIcon}>🔒</Text>
                    <Text style={styles.lockedTitle}>{config.label}</Text>
                    <Text style={styles.lockedSub}>Unlock all 3 variants with a Launch Pass</Text>
                    <TouchableOpacity
                      style={styles.unlockBtn}
                      onPress={() => router.push('/subscription')}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.unlockBtnText}>Get a Launch Pass →</Text>
                    </TouchableOpacity>
                  </View>
                );
              }

              return (
                <View key={blurb.variant} style={[styles.blurbCard, { backgroundColor: config.bg, borderColor: config.color }]}>
                  <View style={styles.blurbCardHeader}>
                    <View style={[styles.hookBadge, { borderColor: config.color }]}>
                      <Text style={styles.hookIcon}>{config.icon}</Text>
                      <Text style={[styles.hookLabel, { color: config.color }]}>{config.label}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.copyBtn, copied === blurb.variant && styles.copyBtnSuccess]}
                      onPress={() => copyBlurb(blurb.text, blurb.variant)}
                    >
                      <Text style={styles.copyBtnText}>
                        {copied === blurb.variant ? '✓ Copied' : 'Copy'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.blurbText}>{blurb.text}</Text>
                </View>
              );
            })}

            <TouchableOpacity
              style={styles.regenerateBtn}
              onPress={generateBlurbs}
              activeOpacity={0.85}
            >
              <Text style={styles.regenerateBtnText}>↺ Generate New Variants</Text>
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

  genrePicker: { backgroundColor: '#0F0F1A', borderRadius: 10, borderWidth: 1, borderColor: '#2A2A44', padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  genreSelected: { color: '#F5F5F5', fontSize: 15 },
  genrePlaceholder: { color: '#555577', fontSize: 15 },
  genreChevron: { color: '#8888AA', fontSize: 12 },
  genreDropdown: { backgroundColor: '#0F0F1A', borderRadius: 10, borderWidth: 1, borderColor: '#2A2A44', maxHeight: 200 },
  genreScroll: { padding: 8 },
  genreOption: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  genreOptionSelected: { backgroundColor: '#2A1A00' },
  genreOptionText: { color: '#8888AA', fontSize: 14 },
  genreOptionTextSelected: { color: '#E8A838', fontWeight: '700' },

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

  blurbCard: { borderRadius: 16, borderWidth: 1.5, padding: 18, gap: 12 },
  blurbCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hookBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  hookIcon: { fontSize: 12 },
  hookLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  blurbText: { fontSize: 15, color: '#F5F5F5', lineHeight: 24 },

  copyBtn: { backgroundColor: '#2A2A44', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  copyBtnSuccess: { backgroundColor: '#1A3A1A' },
  copyBtnText: { color: '#F5F5F5', fontSize: 13, fontWeight: '600' },

  lockedCard: { borderRadius: 16, borderWidth: 1.5, borderColor: '#2A2A44', borderStyle: 'dashed', backgroundColor: '#15152A', padding: 24, alignItems: 'center', gap: 8 },
  lockedIcon: { fontSize: 28 },
  lockedTitle: { fontSize: 14, fontWeight: '800', color: '#8888AA', letterSpacing: 0.5 },
  lockedSub: { fontSize: 13, color: '#555577', marginBottom: 6 },
  unlockBtn: { backgroundColor: '#9945FF', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  unlockBtnText: { color: '#F5F5F5', fontWeight: '800', fontSize: 13 },

  regenerateBtn: { backgroundColor: '#1E1E32', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A44', padding: 14, alignItems: 'center' },
  regenerateBtnText: { color: '#8888AA', fontWeight: '600', fontSize: 15 },
});