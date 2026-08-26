import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Compass,
  FilePlus2,
  Heart,
  Home,
  Image as ImageIcon,
  Layers3,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserCircle2,
  Video,
  WifiOff,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { mobileSessionHeaders, type MobileApiSession, useMobileAuth } from "./auth";
import { normalizeSouthAfricanPhone } from "../../src/phone";
import { AdvancedSearchScreen, CampaignDeliveryScreen, CommunityActionsScreen, GovernanceEditorScreen, MarketplaceParityScreen, OperationsScreen } from "./advanced-workspaces";

declare const process: { env: { EXPO_PUBLIC_API_BASE_URL?: string; EXPO_PUBLIC_TURNSTILE_SITE_KEY?: string } };

type IconProps = { color?: string; size?: number; strokeWidth?: number };
type Icon = React.ComponentType<IconProps>;

type Asset = {
  id: string;
  kind: "image" | "video" | string;
  status: string;
  title: string;
  description?: string;
  caption?: string;
  previewUrl?: string | null;
  sourceUrl?: string | null;
  city?: string | null;
  province?: string | null;
  locality?: string | null;
  landmark?: string | null;
  subjectTags?: string[];
  culturalTags?: string[];
  rightsStatus?: string;
  modelReleaseStatus?: string;
  propertyReleaseStatus?: string;
  humanVerified?: boolean;
  authenticityConfidence?: number;
  contributor?: string | null;
  monetizationModel?: string | null;
  licensePriceCents?: number | null;
  freeDownloadEnabled?: boolean;
};

type SearchResponse = {
  query: string;
  mode: string;
  results: Asset[];
  total: number;
  nextCursor?: string | null;
};

type DiscoveryResponse = {
  trending: Array<{ query: string; searchCount: number }>;
  savedSearches: Array<{ id: string; name: string; query: string }>;
  recommendations: Array<{ asset: Asset; reason: string }>;
  personalized: boolean;
};

type CommunityOverview = {
  forums: Array<{ id: string; name: string; description: string; topicCount: number; postCount: number }>;
  threads: Array<{ id: string; title: string; excerpt: string; author: string; replies: number; lastActivity: string; featured: boolean }>;
  showcases: Array<{ id: string; title: string; description: string; curator: string; theme: string }>;
  collections: Array<{ id: string; title: string; description: string; location: string; assetCount: number; contributorCount: number; featuredLabel: string }>;
};

type CreatorProfile = { id: string; slug: string; name: string; headline: string; bio: string; location: string; specialties: string[]; websiteUrl: string | null; assetCount: number; publishedImageCount: number; reviewCount: number; collectionCount: number };
type AccountLifecycle = { emailVerified: boolean; mfaEnrolled: boolean; emailNotifications: boolean; productNotifications: boolean; exportStatus: string; deletionStatus: string; accountPortalUrl?: string | null };
type AppNotification = { id: string; title: string; body: string; read_at?: string | null; created_at: string };
type UserLightbox = { id: string; name: string; visibility: string; assetIds: string[]; assetCount: number };
type BuyerLicenceRecord = { id: string; assetId: string; assetTitle: string; licenceType: string; territory: string; durationDays: number; priceCents: number; status: string; approvalStatus: string; createdAt: string; originalUrl: string | null };
type CheckoutValidation = { allowed: boolean; blockingReasons: string[]; checks: Array<{ label: string; passed: boolean; detail: string }>; priceCents: number | null; currency: string; monetizationModel: string };
type MarketplaceAgreementDocument = { type: "seller" | "buyer" | "payment"; version: string; title: string; sections: Array<{ heading: string; body: string }> };

type HealthResponse = { ok?: boolean; status?: string; service?: string; version?: string; environment?: string };
type MobileAuth = ReturnType<typeof useMobileAuth>;

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://veld-archive.pages.dev").replace(/\/$/, "");
const COLORS = {
  ink: "#17201D",
  muted: "#68716D",
  paper: "#F6F5F1",
  surface: "#FFFFFF",
  line: "#E4E6DF",
  green: "#187A58",
  greenSoft: "#E4F1EA",
  amber: "#B36B19",
  amberSoft: "#FFF1DA",
  blue: "#2D6580",
  blueSoft: "#E5F0F4",
};

type TabKey = "explore" | "search" | "create" | "more";

function tabsForRole(role?: string): Array<{ key: TabKey; label: string; icon: Icon }> {
  return [
    { key: "explore", label: "Explore", icon: Home },
    { key: "search", label: "Search", icon: Search },
    { key: "create", label: role === "buyer" ? "Buyer" : role === "contributor" ? "Upload" : role === "editor" || role === "admin" ? "Upload" : "Sell", icon: role === "buyer" ? Layers3 : Plus },
    { key: "more", label: "More", icon: Activity },
  ];
}

function queryString(values: Record<string, string | undefined>) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value ?? "")}`)
    .join("&");
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

async function apiPost<T>(path: string, payload: unknown, session?: MobileApiSession | null): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(session ? mobileSessionHeaders(session) : {}) },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null) as T | null;
  return { status: response.status, body };
}

async function apiRequest<T>(path: string, session: MobileApiSession, init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } = {}): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...mobileSessionHeaders(session),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = await response.json().catch(() => null) as T | null;
  return { status: response.status, body };
}

function locationFor(asset: Asset) {
  return [asset.locality, asset.city, asset.province].filter(Boolean).join(", ") || "Location pending";
}

function imageFor(asset: Asset) {
  const previewUrl = asset.previewUrl?.trim();
  if (previewUrl) {
    if (/^https?:\/\//i.test(previewUrl)) return previewUrl;
    return `${API_BASE_URL}/${previewUrl.replace(/^\/+/, "")}`;
  }
  return `${API_BASE_URL}/api/assets/${encodeURIComponent(asset.id)}/preview`;
}

function confidenceFor(asset: Asset) {
  const value = Number(asset.authenticityConfidence ?? 0);
  return value > 1 ? Math.round(value) : Math.round(value * 100);
}

function ExploreScreen({ onOpenAsset, onSearch, onAccount }: { onOpenAsset: (asset: Asset) => void; onSearch: (query: string) => void; onAccount: () => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [search, nextDiscovery] = await Promise.all([
        apiGet<SearchResponse>(`/api/assets?${queryString({ kind: "all", status: "published", sort: "newest" })}`),
        apiGet<DiscoveryResponse>("/api/discovery"),
      ]);
      setAssets(search.results);
      setDiscovery(nextDiscovery);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The archive is unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refresh = () => { setRefreshing(true); void load(); };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.green} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topRow}>
        <View>
          <Text style={styles.eyebrow}>VELD ARCHIVE</Text>
          <Text style={styles.screenTitle}>Find the story.</Text>
        </View>
        <Pressable style={styles.avatarButton} onPress={onAccount} accessibilityLabel="Account">
          <UserCircle2 color={COLORS.ink} size={22} strokeWidth={1.8} />
        </Pressable>
      </View>

      <Pressable style={styles.searchBar} onPress={() => onSearch("")}>
        <Search color={COLORS.muted} size={20} />
        <Text style={styles.searchPlaceholder}>Search places, people, moments</Text>
        <View style={styles.searchAction}><ArrowUpRight color={COLORS.surface} size={17} /></View>
      </Pressable>

      <View style={styles.heroBand}>
        <View style={styles.heroCopy}>
          <Text style={styles.heroKicker}>EDITORIAL COLLECTION</Text>
          <Text style={styles.heroTitle}>Culture, with context.</Text>
          <Text style={styles.heroText}>Rights-aware visual material, reviewed for real-world use.</Text>
          <Pressable style={styles.heroButton} onPress={() => onSearch("South Africa")}>
            <Text style={styles.heroButtonText}>Explore archive</Text>
            <ChevronRight color={COLORS.surface} size={17} />
          </Pressable>
        </View>
        <View style={styles.heroMark}><Layers3 color={COLORS.green} size={58} strokeWidth={1.2} /></View>
      </View>

      <SectionHeader title="Trending now" action="See all" onPress={() => onSearch(discovery?.trending[0]?.query ?? "")} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {(discovery?.trending.length ? discovery.trending : [{ query: "South Africa", searchCount: 0 }, { query: "Cape Town", searchCount: 0 }, { query: "Heritage", searchCount: 0 }]).map((trend) => (
          <Pressable key={trend.query} style={styles.trendChip} onPress={() => onSearch(trend.query)}>
            <Sparkles color={COLORS.amber} size={14} />
            <Text style={styles.trendText}>{trend.query}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <SectionHeader title="Latest in the archive" action="Browse" onPress={() => onSearch("")} />
      {loading ? <LoadingState label="Loading the archive" /> : error ? <ErrorState message={error} onRetry={load} /> : assets.length === 0 ? <EmptyState /> : (
        <View style={styles.assetGrid}>
          {assets.slice(0, 6).map((asset) => <AssetCard key={asset.id} asset={asset} onPress={() => onOpenAsset(asset)} />)}
        </View>
      )}

      {discovery?.recommendations.length ? (
        <>
          <SectionHeader title="For your eye" action="Refresh" onPress={load} />
          <View style={styles.recommendationList}>
            {discovery.recommendations.slice(0, 3).map(({ asset, reason }) => (
              <Pressable key={asset.id} style={styles.recommendation} onPress={() => onOpenAsset(asset)}>
                <Image source={{ uri: imageFor(asset) }} style={styles.recommendationImage} />
                <View style={styles.recommendationCopy}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{asset.title}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>{reason}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>{locationFor(asset)}</Text>
                </View>
                <ChevronRight color={COLORS.muted} size={18} />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function SearchScreen({ initialQuery, onOpenAsset, auth }: { initialQuery: string; onOpenAsset: (asset: Asset) => void; auth: MobileAuth }) {
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState("relevance");
  const [results, setResults] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<string | null>(null);

  const search = useCallback(async (nextQuery = query) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<SearchResponse>(`/api/assets?${queryString({ q: nextQuery.trim(), kind, status: "published", sort })}`);
      setResults(response.results);
      setSearchMode(response.mode);
      setHasSearched(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [kind, query, sort]);

  useEffect(() => { if (initialQuery) void search(initialQuery); }, [initialQuery, search]);

  const saveSearch = async () => {
    if (!auth.session || !query.trim()) return;
    const response = await apiRequest<{ error?: string }>("/api/saved-searches", auth.session, { method: "POST", body: { name: query.trim(), query: query.trim(), mediaKind: kind, alertFrequency: "weekly" } });
    setNotice(response.status === 201 ? "Search saved with weekly in-app alerts." : messageFrom(response.body, "The search could not be saved."));
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>DISCOVER</Text>
      <Text style={styles.screenTitle}>Search the archive</Text>
      <View style={styles.searchInputWrap}>
        <Search color={COLORS.muted} size={19} />
        <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="Try a place or subject" placeholderTextColor={COLORS.muted} style={styles.searchInput} returnKeyType="search" />
        {query ? <Pressable onPress={() => setQuery("")}><X color={COLORS.muted} size={18} /></Pressable> : null}
      </View>
      <View style={styles.segmentRow}>
        {[{ key: "all", label: "All", icon: Layers3 }, { key: "image", label: "Images", icon: ImageIcon }, { key: "video", label: "Video", icon: Video }].map(({ key, label, icon: SegmentIcon }) => (
          <Pressable key={key} style={[styles.segment, kind === key && styles.segmentActive]} onPress={() => setKind(key)}>
            <SegmentIcon color={kind === key ? COLORS.surface : COLORS.muted} size={15} />
            <Text style={[styles.segmentText, kind === key && styles.segmentTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.sortRow}>
        {[{ key: "relevance", label: "Relevant" }, { key: "newest", label: "Newest" }, { key: "popular", label: "Popular" }].map(({ key, label }) => (
          <Pressable key={key} onPress={() => setSort(key)}><Text style={[styles.sortText, sort === key && styles.sortTextActive]}>{label}</Text></Pressable>
        ))}
        <Pressable style={styles.filterButton} onPress={() => Alert.alert("Filters", "Advanced editorial filters are available in the web workspace.")}><Text style={styles.filterText}>Filters</Text></Pressable>
      </View>
      <Pressable style={styles.primaryButton} onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void search(); }}>
        <Search color={COLORS.surface} size={17} /><Text style={styles.primaryButtonText}>Search archive</Text>
      </Pressable>
      {auth.session && query.trim() ? <Pressable style={styles.secondaryButton} onPress={() => void saveSearch()}><Heart color={COLORS.ink} size={16} /><Text style={styles.secondaryButtonText}>Save search · weekly alerts</Text></Pressable> : null}
      {notice ? <View style={styles.notice}><CheckCircle2 color={notice.includes("saved") ? COLORS.green : COLORS.amber} size={18} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
      {loading ? <LoadingState label="Searching" /> : error ? <ErrorState message={error} onRetry={() => search()} /> : hasSearched ? (
        results.length ? <View style={styles.searchResults}>{results.map((asset) => <SearchResult key={asset.id} asset={asset} onPress={() => onOpenAsset(asset)} />)}</View> : <><EmptyState label="No published assets matched this query" />{searchMode === "keyword" ? <View style={styles.inlineNote}><Search color={COLORS.blue} size={17} /><Text style={styles.inlineNoteText}>This API response used keyword search. Semantic AI search is not currently available on the connected Worker.</Text></View> : null}</>
      ) : <View style={styles.searchPrompt}><Compass color={COLORS.green} size={32} /><Text style={styles.searchPromptTitle}>Start with a place, feeling, or subject.</Text></View>}
    </ScrollView>
  );
}

type OnboardingStep = "profile" | "identity" | "payout";
type OnboardingWorkflow = Record<string, unknown> & {
  legal_name?: string | null;
  didit_status?: string | null;
  contract_id?: string | null;
  wallet_id?: string | null;
  wallet_status?: string | null;
  tender_status?: string | null;
  verification_status?: string | null;
};

function messageFrom(body: { error?: unknown } | null, fallback: string) {
  return typeof body?.error === "string" ? body.error : fallback;
}

function formatZar(cents: number | null | undefined) {
  return cents == null ? "Custom quote" : new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(cents / 100);
}

function newUploadIdempotencyKey() {
  return `mobile-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function CheckField({ checked, label, onPress }: { checked: boolean; label: string; onPress: () => void }) {
  return <Pressable style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress}><View style={[styles.checkBox, checked && styles.checkBoxActive]}>{checked ? <CheckCircle2 color={COLORS.surface} size={15} /> : null}</View><Text style={styles.checkLabel}>{label}</Text></Pressable>;
}

function TurnstileChallenge({ onToken }: { onToken: (token: string) => void }) {
  const siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!siteKey || siteKey.startsWith("replace-")) return <View style={styles.inlineNote}><ShieldCheck color={COLORS.blue} size={17} /><Text style={styles.inlineNoteText}>Bot protection is not configured in this build. Local development may use the Worker development bypass; production submissions remain blocked until the public site key is set.</Text></View>;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><style>html,body{margin:0;background:#f6f5f1;height:92px;display:grid;place-items:center}</style></head><body><div class="cf-turnstile" data-sitekey=${JSON.stringify(siteKey)} data-action="contributor-contract" data-callback="done" data-expired-callback="expired"></div><script>function done(token){window.ReactNativeWebView.postMessage(JSON.stringify({token:token}))}function expired(){window.ReactNativeWebView.postMessage(JSON.stringify({token:""}))}</script></body></html>`;
  return <View style={styles.turnstileFrame}><WebView originWhitelist={["https://*"]} source={{ html, baseUrl: `${API_BASE_URL}/` }} javaScriptEnabled onMessage={(event) => { try { const value = JSON.parse(event.nativeEvent.data) as { token?: string }; onToken(value.token ?? ""); } catch { onToken(""); } }} /></View>;
}

function SellerAccess({ auth, initialMode = "signup" }: { auth: MobileAuth; initialMode?: "signin" | "signup" }) {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">(() => auth.passwordRecovery ? "reset" : initialMode);
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (auth.passwordRecovery) {
      setMode("reset");
      setMessage("Choose a new password for your archive account.");
    }
  }, [auth.passwordRecovery]);

  const submit = async () => {
    setMessage(null);
    try {
      if (mode === "forgot") {
        if (!email.trim()) throw new Error("Enter the email address for your archive account.");
        await auth.requestPasswordReset(email);
        setMode("signin");
        setMessage("If an account uses that email, we sent a password reset link. Check your inbox and spam folder.");
        return;
      }
      if (mode === "reset") {
        if (password !== passwordConfirmation) throw new Error("Passwords do not match.");
        await auth.updatePassword(password);
        setPassword("");
        setPasswordConfirmation("");
        setMode("signin");
        setMessage("Your password has been updated. Sign in with your new password.");
        return;
      }
      if (method === "phone") {
        if (!phoneCodeSent) {
          await auth.sendPhoneCode(phone, mode === "signup", "seller");
          setPhoneCodeSent(true);
          setMessage("A 6-digit code was sent by SMS. Enter it here to continue.");
        } else {
          await auth.verifyPhoneCode(phone, phoneCode, displayName, "seller");
          setPhoneCode("");
        }
        return;
      }
      if (mode === "signup") {
        const result = await auth.signUp(email, password, displayName, "seller");
        setPassword("");
        if (result.confirmationRequired) {
          setMode("signin");
          setMessage("Account created. Open the confirmation email on this device, then return here to continue seller setup.");
        }
      } else {
        await auth.signIn(email, password, "seller");
        setPassword("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : mode === "signup" ? "Account creation failed." : "Sign-in failed.");
    }
  };

  const disabled = auth.loading || mode === "forgot"
    ? auth.loading || !email.trim()
    : mode === "reset"
      ? auth.loading || password.length < 8 || password !== passwordConfirmation
      : method === "phone"
        ? auth.loading || !phone.trim() || phoneCodeSent && !/^\d{6}$/.test(phoneCode.trim()) || !phoneCodeSent && mode === "signup" && !displayName.trim()
        : auth.loading || !email.trim() || password.length < 8 || mode === "signup" && !displayName.trim();
  return <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <Text style={styles.eyebrow}>SELL ON VELD</Text>
    <Text style={styles.screenTitle}>{mode === "signup" ? "Create your seller account" : mode === "forgot" ? "Reset your password" : mode === "reset" ? "Choose a new password" : "Welcome back"}</Text>
    <Text style={styles.screenIntro}>{mode === "forgot" ? "Enter your email and we’ll send a secure reset link. For your privacy, the response is the same whether an account exists." : mode === "reset" ? "Your reset link is verified by Supabase. Set a new password, then sign in again." : method === "phone" ? "Use a one-time SMS code. SMS delivery must be enabled for this Supabase project." : mode === "signup" ? "Start as an individual or registered company. Identity, rights, payout, and editorial approval follow after email verification." : "Sign in to continue onboarding, upload work, or check review status."}</Text>
    {!auth.configured ? <View style={styles.notice}><WifiOff color={COLORS.amber} size={18} /><Text style={styles.noticeText}>Supabase authentication is not configured for this build. Add the Expo public Supabase URL and publishable key.</Text></View> : <>
      {mode !== "forgot" && mode !== "reset" && <><Text style={styles.fieldLabel}>Verification method</Text><View style={styles.segmentRow}><Pressable style={[styles.compactSegment, method === "email" && styles.segmentActive]} onPress={() => { setMethod("email"); setPhoneCodeSent(false); setMessage(null); }}><Text style={[styles.segmentText, method === "email" && styles.segmentTextActive]}>Email</Text></Pressable><Pressable style={[styles.compactSegment, method === "phone" && styles.segmentActive]} onPress={() => { setMethod("phone"); setPhoneCodeSent(false); setMessage(null); }}><Text style={[styles.segmentText, method === "phone" && styles.segmentTextActive]}>SMS</Text></Pressable></View></>}
      {mode === "reset" ? <>
        <Field label="New password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" />
        <Field label="Confirm new password" value={passwordConfirmation} onChangeText={setPasswordConfirmation} placeholder="Enter the password again" secureTextEntry autoCapitalize="none" />
      </> : mode === "forgot" ? <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" /> : method === "phone" ? <>
        {mode === "signup" ? <Field label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="How your name should appear" autoCapitalize="words" /> : null}
        <Field label="Phone number" value={phone} onChangeText={setPhone} placeholder="073 712 3456" autoCapitalize="none" keyboardType="phone-pad" editable={!phoneCodeSent} />
        {!phoneCodeSent ? <Text style={styles.fieldHint}>South African mobile numbers only. You do not need to type +27.</Text> : null}
        {phoneCodeSent ? <Field label="SMS code" value={phoneCode} onChangeText={setPhoneCode} placeholder="6-digit code" keyboardType="number-pad" autoCapitalize="none" maxLength={6} /> : null}
      </> : <>
        {mode === "signup" ? <Field label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="How your name should appear" autoCapitalize="words" /> : null}
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" />
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" />
      </>}
      {(message || auth.error) ? <View style={styles.notice}><ShieldCheck color={COLORS.amber} size={18} /><Text style={styles.noticeText}>{message ?? auth.error}</Text></View> : null}
      <Pressable style={[styles.primaryButton, disabled && styles.disabledButton]} disabled={disabled} onPress={() => void submit()}>
        {auth.loading ? <ActivityIndicator color={COLORS.surface} /> : <><LogIn color={COLORS.surface} size={17} /><Text style={styles.primaryButtonText}>{mode === "forgot" ? "Send reset link" : mode === "reset" ? "Update password" : method === "phone" ? phoneCodeSent ? "Verify SMS code" : "Send SMS code" : mode === "signup" ? "Create seller account" : "Sign in"}</Text></>}
      </Pressable>
      {mode === "signin" && method === "email" ? <Pressable style={styles.secondaryButton} onPress={() => { setMode("forgot"); setMessage(null); setPassword(""); }}><Text style={styles.secondaryButtonText}>Forgot password?</Text></Pressable> : null}
      {mode === "forgot" || mode === "reset" ? <Pressable style={styles.secondaryButton} onPress={() => { setMode("signin"); setMessage(null); setPassword(""); setPasswordConfirmation(""); }}><Text style={styles.secondaryButtonText}>Back to sign in</Text></Pressable> : null}
      {mode === "signin" || mode === "signup" ? <Pressable style={styles.secondaryButton} onPress={() => { setMode((current) => current === "signup" ? "signin" : "signup"); setMessage(null); setPassword(""); setPasswordConfirmation(""); setPhoneCodeSent(false); }}><Text style={styles.secondaryButtonText}>{mode === "signup" ? "I already have an account" : "Create a seller account"}</Text></Pressable> : null}
    </>}
  </ScrollView>;
}

function SellerOnboarding({ session }: { session: MobileApiSession }) {
  const [step, setStep] = useState<OnboardingStep>("profile");
  const [workflow, setWorkflow] = useState<OnboardingWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [contributorType, setContributorType] = useState("individual");
  const [location, setLocation] = useState("");
  const [languages, setLanguages] = useState("English");
  const [specialties, setSpecialties] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [profileTerms, setProfileTerms] = useState(false);
  const [sellerType, setSellerType] = useState<"individual" | "company">("individual");
  const [legalName, setLegalName] = useState("");
  const [phone, setPhone] = useState("");
  const [identityDocumentType, setIdentityDocumentType] = useState<"sa_id" | "passport">("sa_id");
  const [bankAccountName, setBankAccountName] = useState("");
  const [registeredName, setRegisteredName] = useState("");
  const [cipcRegistrationNumber, setCipcRegistrationNumber] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [representativeAuthority, setRepresentativeAuthority] = useState(false);
  const [beneficialOwnerRequired, setBeneficialOwnerRequired] = useState(false);
  const [copyrightDeclaration, setCopyrightDeclaration] = useState(false);
  const [taxResponsibilityDeclaration, setTaxResponsibilityDeclaration] = useState(false);
  const [contributorAgreement, setContributorAgreement] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signatureReference, setSignatureReference] = useState("");
  const [providerAccountId, setProviderAccountId] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [accountLast4, setAccountLast4] = useState("");
  const [branchLast4, setBranchLast4] = useState("");
  const [contractAccepted, setContractAccepted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await apiRequest<{ workflow?: OnboardingWorkflow | null }>("/api/onboarding/status", session);
    if (response.status === 200) setWorkflow(response.body?.workflow ?? null);
    else setMessage(messageFrom(response.body as { error?: unknown } | null, "Seller status is temporarily unavailable."));
    setLoading(false);
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  const saveProfile = async () => {
    if (!profileTerms) { setMessage("Accept the contributor terms to submit your profile."); return; }
    setSaving(true); setMessage(null);
    const response = await apiRequest<{ status?: string; error?: string }>("/api/onboarding", session, { method: "PUT", body: {
      bio: bio.trim(), organisationName: organisationName.trim() || undefined, contributorType, location: location.trim() || undefined,
      languages: languages.split(",").map((value) => value.trim()).filter(Boolean), specialties: specialties.split(",").map((value) => value.trim()).filter(Boolean),
      equipment: "", portfolioUrl: portfolioUrl.trim(), acceptTerms: true,
    } });
    setSaving(false);
    if (response.status !== 200) { setMessage(messageFrom(response.body, "Your contributor profile could not be saved.")); return; }
    setMessage("Contributor profile saved. Next, verify the person or company receiving payouts."); setStep("identity"); await load();
  };

  const saveIdentity = async () => {
    let normalizedPhone: string;
    try { normalizedPhone = normalizeSouthAfricanPhone(phone); } catch (error) { setMessage(error instanceof Error ? error.message : "Enter a valid South African mobile number, for example 073 712 3456."); return; }
    if (!ageConfirmed || !copyrightDeclaration || !taxResponsibilityDeclaration || !contributorAgreement) { setMessage("Complete the age, rights, tax, and contributor declarations."); return; }
    if (sellerType === "company" && (!registeredName.trim() || !cipcRegistrationNumber.trim() || !representativeName.trim() || !representativeAuthority)) { setMessage("Complete the registered company and representative details."); return; }
    setSaving(true); setMessage(null);
    const seller = await apiRequest<{ error?: string }>("/api/onboarding/seller", session, { method: "PUT", body: {
      sellerType, legalName: legalName.trim(), phone: normalizedPhone, ageConfirmed: true, identityDocumentType, bankAccountName: bankAccountName.trim(),
      copyrightDeclaration: true, taxResponsibilityDeclaration: true, contributorAgreement: true,
      ...(sellerType === "company" ? { registeredName: registeredName.trim(), cipcRegistrationNumber: cipcRegistrationNumber.trim(), representativeName: representativeName.trim(), representativeAuthority, beneficialOwnerRequired } : {}),
    } });
    if (seller.status !== 200) { setSaving(false); setMessage(messageFrom(seller.body, "Seller details could not be saved.")); return; }
    if (sellerType === "company") {
      const cipc = await apiRequest<{ error?: string }>("/api/onboarding/cipc/lookup", session, { method: "POST", body: { registrationNumber: cipcRegistrationNumber.trim() } });
      if (cipc.status !== 200) { setSaving(false); setMessage(messageFrom(cipc.body, "Seller details were saved, but company verification is unavailable. Retry this step when CIPC is available.")); await load(); return; }
    }
    const didit = await apiRequest<{ url?: string; error?: string }>("/api/onboarding/didit/session", session, { method: "POST", body: {} });
    setSaving(false);
    if (didit.status === 201 && didit.body?.url) {
      setMessage("Seller details saved. Complete the secure hosted identity check, then return to finish payout setup.");
      await Linking.openURL(didit.body.url);
      setStep("payout");
    } else if (didit.status === 409) {
      setMessage("Identity verification is already in progress. Continue it from the provider message, then finish payout setup here."); setStep("payout");
    } else setMessage(messageFrom(didit.body, "Seller details were saved, but identity verification could not start. Retry when the provider is available."));
    await load();
  };

  const submitTender = async () => {
    if (!contractAccepted) { setMessage("Accept the current contributor terms before signing."); return; }
    if (signatureReference.trim().length < 8) { setMessage("Enter the Firma signature reference returned by the signing flow."); return; }
    if (!/^ACCT_[A-Za-z0-9]+$/.test(providerAccountId.trim())) { setMessage("Enter a valid Paystack subaccount code beginning with ACCT_."); return; }
    if ((accountLast4 && !/^\d{4}$/.test(accountLast4)) || (branchLast4 && !/^\d{4}$/.test(branchLast4))) { setMessage("Account and branch references must contain exactly four digits when provided."); return; }
    setSaving(true); setMessage(null);
    const contract = await apiRequest<{ error?: string }>("/api/onboarding/contract", session, { method: "POST", body: { signerName: signerName.trim(), signatureMethod: "firma", signatureReference: signatureReference.trim(), ...(turnstileToken ? { turnstileToken } : {}) } });
    if (contract.status !== 201) { setSaving(false); setMessage(messageFrom(contract.body, "The signed contributor contract could not be verified.")); return; }
    const wallet = await apiRequest<{ error?: string }>("/api/onboarding/wallet", session, { method: "POST", body: { provider: "paystack", providerAccountId: providerAccountId.trim(), accountHolderName: accountHolderName.trim(), ...(accountLast4 ? { accountLast4 } : {}), ...(branchLast4 ? { branchLast4 } : {}), currency: "ZAR" } });
    setSaving(false);
    if (wallet.status !== 201) { setMessage(messageFrom(wallet.body, "The contract was signed, but payout setup needs another attempt.")); await load(); return; }
    setMessage("Seller tender submitted. Identity, payout, rights, and contract evidence are now pending review."); await load();
  };

  if (loading) return <LoadingState label="Loading seller progress" />;
  const progress = [Boolean(workflow), Boolean(workflow?.legal_name), Boolean(workflow?.contract_id && workflow?.wallet_id)].filter(Boolean).length;
  return <View>
    <View style={styles.progressCard}><Text style={styles.cardKind}>SELLER ONBOARDING · {progress}/3</Text><Text style={styles.cardTitle}>{workflow?.tender_status ? `Tender ${String(workflow.tender_status).replaceAll("_", " ")}` : "Complete your seller record"}</Text><Text style={styles.cardMeta}>Identity {String(workflow?.didit_status ?? workflow?.verification_status ?? "not started")} · payout {String(workflow?.wallet_status ?? "not started")}</Text></View>
    <View style={styles.stepRow}>{(["profile", "identity", "payout"] as OnboardingStep[]).map((value, index) => <Pressable key={value} style={[styles.stepButton, step === value && styles.stepButtonActive]} onPress={() => setStep(value)}><Text style={[styles.stepNumber, step === value && styles.stepTextActive]}>{index + 1}</Text><Text style={[styles.stepText, step === value && styles.stepTextActive]}>{value === "identity" ? "Verify" : value === "payout" ? "Tender" : "Profile"}</Text></Pressable>)}</View>
    {message ? <View style={styles.notice}><ShieldCheck color={message.includes("saved") || message.includes("submitted") ? COLORS.green : COLORS.amber} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}
    {step === "profile" ? <View style={styles.formCard}><Text style={styles.sectionTitle}>Contributor profile</Text><Text style={styles.screenIntro}>Tell editors what you make and where you work. Only approved public profile fields become discoverable.</Text>
      <Field label="Bio (optional)" value={bio} onChangeText={setBio} placeholder="Your practice and point of view" multiline />
      <Field label="Organisation (optional)" value={organisationName} onChangeText={setOrganisationName} placeholder="Studio, archive, or agency" />
      <Text style={styles.fieldLabel}>Contributor type</Text><View style={styles.segmentRow}>{["individual", "agency", "archive", "institution"].map((value) => <Pressable key={value} style={[styles.compactSegment, contributorType === value && styles.segmentActive]} onPress={() => setContributorType(value)}><Text style={[styles.segmentText, contributorType === value && styles.segmentTextActive]}>{value}</Text></Pressable>)}</View>
      <Field label="Location (optional)" value={location} onChangeText={setLocation} placeholder="City or province" />
      <Field label="Languages" value={languages} onChangeText={setLanguages} placeholder="Comma separated" />
      <Field label="Specialties" value={specialties} onChangeText={setSpecialties} placeholder="Editorial, portrait, landscape" />
      <Field label="Portfolio URL (optional)" value={portfolioUrl} onChangeText={setPortfolioUrl} placeholder="https://" autoCapitalize="none" keyboardType="url" />
      <CheckField checked={profileTerms} onPress={() => setProfileTerms((value) => !value)} label="I accept the contributor terms and consent to editorial review." />
      <Pressable style={[styles.primaryButton, saving && styles.disabledButton]} disabled={saving} onPress={() => void saveProfile()}>{saving ? <ActivityIndicator color={COLORS.surface} /> : <Text style={styles.primaryButtonText}>Save profile and continue</Text>}</Pressable>
    </View> : null}
    {step === "identity" ? <View style={styles.formCard}><Text style={styles.sectionTitle}>Seller identity</Text><Text style={styles.screenIntro}>Didit handles ID/passport and liveness checks. Veld stores the decision and provider reference, not raw documents.</Text>
      <Text style={styles.fieldLabel}>Seller type</Text><View style={styles.segmentRow}>{(["individual", "company"] as const).map((value) => <Pressable key={value} style={[styles.segment, sellerType === value && styles.segmentActive]} onPress={() => setSellerType(value)}><Text style={[styles.segmentText, sellerType === value && styles.segmentTextActive]}>{value === "individual" ? "Individual" : "Company"}</Text></Pressable>)}</View>
      <Field label="Legal name" value={legalName} onChangeText={setLegalName} placeholder="As shown on ID or registration" autoCapitalize="words" />
      <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="073 712 3456" keyboardType="phone-pad" autoCapitalize="none" />
      <Text style={styles.fieldLabel}>Identity document</Text><View style={styles.segmentRow}>{(["sa_id", "passport"] as const).map((value) => <Pressable key={value} style={[styles.segment, identityDocumentType === value && styles.segmentActive]} onPress={() => setIdentityDocumentType(value)}><Text style={[styles.segmentText, identityDocumentType === value && styles.segmentTextActive]}>{value === "sa_id" ? "South African ID" : "Passport"}</Text></Pressable>)}</View>
      {sellerType === "company" ? <><Field label="Registered company name" value={registeredName} onChangeText={setRegisteredName} placeholder="CIPC registered name" /><Field label="CIPC registration number" value={cipcRegistrationNumber} onChangeText={setCipcRegistrationNumber} placeholder="Registration number" autoCapitalize="characters" /><Field label="Authorised representative" value={representativeName} onChangeText={setRepresentativeName} placeholder="Director or authorised person" /><CheckField checked={representativeAuthority} onPress={() => setRepresentativeAuthority((value) => !value)} label="I am authorised to act for this company." /><CheckField checked={beneficialOwnerRequired} onPress={() => setBeneficialOwnerRequired((value) => !value)} label="Beneficial-owner information is required for this seller." /></> : null}
      <Field label="Bank account name" value={bankAccountName} onChangeText={setBankAccountName} placeholder="Name only — never enter the account number" />
      <CheckField checked={ageConfirmed} onPress={() => setAgeConfirmed((value) => !value)} label="I confirm I am at least 18." />
      <CheckField checked={copyrightDeclaration} onPress={() => setCopyrightDeclaration((value) => !value)} label="I own or control the copyright and required releases." />
      <CheckField checked={taxResponsibilityDeclaration} onPress={() => setTaxResponsibilityDeclaration((value) => !value)} label="I accept responsibility for my tax affairs." />
      <CheckField checked={contributorAgreement} onPress={() => setContributorAgreement((value) => !value)} label="I accept the contributor agreement and licensing terms." />
      <Pressable style={[styles.primaryButton, saving && styles.disabledButton]} disabled={saving} onPress={() => void saveIdentity()}>{saving ? <ActivityIndicator color={COLORS.surface} /> : <><ShieldCheck color={COLORS.surface} size={17} /><Text style={styles.primaryButtonText}>Save and start verification</Text></>}</Pressable>
    </View> : null}
    {step === "payout" ? <View style={styles.formCard}><Text style={styles.sectionTitle}>Contract and payout</Text><Text style={styles.screenIntro}>The Paystack subaccount, Firma reference, verification case, and signed contract form one reviewable seller tender. Raw banking credentials are never collected here.</Text>
      <Field label="Signer name" value={signerName} onChangeText={setSignerName} placeholder="Full legal name" />
      <Field label="Firma signature reference" value={signatureReference} onChangeText={setSignatureReference} placeholder="Reference returned by Firma" autoCapitalize="none" />
      <Field label="Paystack subaccount code" value={providerAccountId} onChangeText={setProviderAccountId} placeholder="ACCT_..." autoCapitalize="characters" />
      <Field label="Account holder" value={accountHolderName} onChangeText={setAccountHolderName} placeholder="Must match the seller record" />
      <View style={styles.twoColumn}><View style={styles.column}><Field label="Account last 4 (optional)" value={accountLast4} onChangeText={setAccountLast4} placeholder="1234" keyboardType="number-pad" /></View><View style={styles.column}><Field label="Branch last 4 (optional)" value={branchLast4} onChangeText={setBranchLast4} placeholder="5678" keyboardType="number-pad" /></View></View>
      <TurnstileChallenge onToken={setTurnstileToken} />
      <CheckField checked={contractAccepted} onPress={() => setContractAccepted((value) => !value)} label="I agree to the current Contributor Terms and authorise this digital signature record." />
      <Pressable style={[styles.primaryButton, saving && styles.disabledButton]} disabled={saving} onPress={() => void submitTender()}>{saving ? <ActivityIndicator color={COLORS.surface} /> : <Text style={styles.primaryButtonText}>Submit seller tender</Text>}</Pressable>
    </View> : null}
  </View>;
}

function SellerLibrary({ session }: { session: MobileApiSession }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [caption, setCaption] = useState("");
  const [city, setCity] = useState("");
  const [tags, setTags] = useState("");
  const [rights, setRights] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const choose = (asset: Asset) => { setSelected(asset); setTitle(asset.title); setDescription(asset.description ?? ""); setCaption(asset.caption ?? ""); setCity(asset.city ?? ""); setTags((asset.subjectTags ?? []).join(", ")); setRights(asset.rightsStatus ?? "pending"); };
  const load = useCallback(async () => { setLoading(true); const response = await apiRequest<{ results?: Asset[]; error?: string }>("/api/my/assets", session); const next = response.body?.results ?? []; if (response.status === 200) { setAssets(next); setSelected((current) => { const match = next.find((asset) => asset.id === current?.id) ?? next[0] ?? null; if (match) { setTitle(match.title); setDescription(match.description ?? ""); setCaption(match.caption ?? ""); setCity(match.city ?? ""); setTags((match.subjectTags ?? []).join(", ")); setRights(match.rightsStatus ?? "pending"); } return match; }); setMessage(null); } else setMessage(messageFrom(response.body ?? null, "Your seller assets could not be loaded.")); setLoading(false); }, [session]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => { if (!selected || !title.trim() || !description.trim()) { setMessage("Title and description are required."); return; } setSaving(true); const response = await apiRequest<{ error?: string }>(`/api/assets/${encodeURIComponent(selected.id)}`, session, { method: "PATCH", body: { kind: selected.kind, title: title.trim(), description: description.trim(), caption: caption.trim(), city: city.trim() || null, subjectTags: tags.split(",").map((value) => value.trim()).filter(Boolean), culturalTags: selected.culturalTags ?? [], rightsStatus: rights, modelReleaseStatus: selected.modelReleaseStatus ?? "unknown", propertyReleaseStatus: selected.propertyReleaseStatus ?? "unknown" } }); setSaving(false); setMessage(response.status === 200 ? "Metadata saved. Editorial review still controls publication." : messageFrom(response.body, "Metadata could not be saved.")); if (response.status === 200) await load(); };
  if (loading) return <LoadingState label="Loading your photo library" />;
  return <View><View style={styles.progressCard}><Text style={styles.cardKind}>YOUR PHOTO LIBRARY</Text><Text style={styles.cardTitle}>{assets.length} owned record{assets.length === 1 ? "" : "s"}</Text><Text style={styles.cardMeta}>{assets.filter((asset) => asset.status === "published").length} published · {assets.filter((asset) => asset.status === "needs_review").length} held for review</Text></View>{message ? <View style={styles.notice}><ShieldCheck color={message.includes("saved") ? COLORS.green : COLORS.amber} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}{!assets.length ? <EmptyState label="No uploaded records yet. Use Upload to submit your first photo." /> : <><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.libraryRow}>{assets.map((asset) => <Pressable key={asset.id} style={[styles.libraryItem, selected?.id === asset.id && styles.libraryItemActive]} onPress={() => choose(asset)}><Image source={{ uri: imageFor(asset) }} style={styles.libraryThumb} /><Text style={styles.cardTitle} numberOfLines={1}>{asset.title}</Text><Text style={styles.cardMeta}>{asset.status.replaceAll("_", " ")}</Text></Pressable>)}</ScrollView>{selected ? <View style={styles.formCard}><Text style={styles.cardKind}>SELLER-OWNED RECORD · {selected.status.replaceAll("_", " ")}</Text><Text style={styles.sectionTitle}>Update metadata</Text><Text style={styles.screenIntro}>Changes stay auditable and return to editorial review when required.</Text><Field label="Title" value={title} onChangeText={setTitle} placeholder="Asset title" /><Field label="Description" value={description} onChangeText={setDescription} placeholder="What is visible and what you can verify" multiline /><Field label="Caption (optional)" value={caption} onChangeText={setCaption} placeholder="Concise buyer-facing context" multiline /><Field label="City (optional)" value={city} onChangeText={setCity} placeholder="Evidence-backed location" /><Field label="Subject tags" value={tags} onChangeText={setTags} placeholder="Comma separated" /><Text style={styles.fieldLabel}>Rights status</Text><View style={styles.segmentRow}>{["pending", "editorial_only", "verified", "restricted"].map((value) => <Pressable key={value} style={[styles.compactSegment, rights === value && styles.segmentActive]} onPress={() => setRights(value)}><Text style={[styles.segmentText, rights === value && styles.segmentTextActive]}>{value.replaceAll("_", " ")}</Text></Pressable>)}</View><Pressable style={[styles.primaryButton, saving && styles.disabledButton]} disabled={saving} onPress={() => void save()}>{saving ? <ActivityIndicator color={COLORS.surface} /> : <Text style={styles.primaryButtonText}>Save metadata</Text>}</Pressable></View> : null}</>}</View>;
}

function MobileBuyerHome({ session }: { session: MobileApiSession }) {
  const [licences, setLicences] = useState<BuyerLicenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => { setLoading(true); const response = await apiRequest<{ results: BuyerLicenceRecord[]; error?: string }>("/api/my/licences", session); setLoading(false); if (response.status === 200) { setLicences(response.body?.results ?? []); setMessage(""); } else { setLicences([]); setMessage(response.body?.error ?? "Your licences are temporarily unavailable."); } }, [session]);
  useEffect(() => { void load(); }, [load]);
  const continuePayment = async (licence: BuyerLicenceRecord) => { const response = await apiRequest<{ checkoutUrl?: string; error?: string }>(`/api/payments/${encodeURIComponent(licence.id)}/session`, session, { method: "POST", body: { successUrl: `${API_BASE_URL}/buyer?licence=${encodeURIComponent(licence.id)}&payment=complete`, cancelUrl: `${API_BASE_URL}/buyer?licence=${encodeURIComponent(licence.id)}&payment=cancelled` } }); if (response.status === 201 && response.body?.checkoutUrl) await Linking.openURL(response.body.checkoutUrl); else setMessage(`The pending licence is safe. ${response.body?.error ?? "Paystack checkout could not be opened."}`); };
  const openOriginal = async (licence: BuyerLicenceRecord) => { if (!licence.originalUrl) { setMessage("The original is still being prepared."); return; } const response = await fetch(`${API_BASE_URL}${licence.originalUrl}`, { headers: mobileSessionHeaders(session), redirect: "follow" }); if (!response.ok) { setMessage("The licensed original is not available yet."); return; } await Linking.openURL(response.url); };
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}><Text style={styles.eyebrow}>BUYER WORKSPACE</Text><Text style={styles.screenTitle}>From search to controlled delivery</Text><Text style={styles.screenIntro}>Use Search to inspect an asset, then validate rights, accept the current terms, and pay without losing your place.</Text><View style={styles.mobileFlowSteps}>{[["1", "Search"], ["2", "Inspect"], ["3", "Validate"], ["4", "Pay"], ["5", "Deliver"]].map(([number, label]) => <View key={number} style={styles.mobileFlowStep}><Text style={styles.stepNumber}>{number}</Text><Text style={styles.cardTitle}>{label}</Text></View>)}</View><View style={styles.inlineNote}><ShieldCheck color={COLORS.blue} size={17} /><Text style={styles.inlineNoteText}>A Paystack redirect is not proof of payment. Original access appears only after the signed webhook updates the licence.</Text></View><SectionHeader title="Licences & delivery" action="Refresh" onPress={() => void load()} />{loading ? <LoadingState label="Loading licence requests" /> : message && !licences.length ? <ErrorState message={message} onRetry={load} /> : licences.length ? <View style={styles.stack}>{licences.map((licence) => <View key={licence.id} style={styles.listCard}><View style={styles.cardLabelRow}><Text style={styles.cardKind}>{licence.status.toUpperCase()}</Text><Text style={styles.cardKind}>{formatZar(licence.priceCents)}</Text></View><Text style={styles.cardTitle}>{licence.assetTitle}</Text><Text style={styles.cardMeta}>{licence.licenceType} · {licence.territory} · {licence.durationDays} days</Text>{licence.status === "pending" ? <Pressable style={styles.secondaryButton} onPress={() => void continuePayment(licence)}><Text style={styles.secondaryButtonText}>Continue payment</Text></Pressable> : licence.status === "paid" ? <Pressable style={styles.secondaryButton} onPress={() => void openOriginal(licence)}><Text style={styles.secondaryButtonText}>Open licensed original</Text></Pressable> : null}</View>)}</View> : <EmptyState label="No licence requests yet. Open Search, choose an asset, then tap Licence media." />}{message && licences.length ? <View style={styles.notice}><ShieldCheck color={COLORS.amber} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}</ScrollView>;
}

function CreateScreen({ auth, initialAuthMode = "signup" }: { auth: MobileAuth; initialAuthMode?: "signin" | "signup" }) {
  const [section, setSection] = useState<"onboarding" | "upload" | "library">("upload");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [city, setCity] = useState("");
  const [tags, setTags] = useState("");
  const [kind, setKind] = useState<"image" | "video">("image");
  const [rights, setRights] = useState("pending");
  const [selectedMedia, setSelectedMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState("");
  const [uploadIdempotencyKey, setUploadIdempotencyKey] = useState(() => newUploadIdempotencyKey());

  const pickMedia = async () => {
    if (kind === "video") {
      setMessage("Video submissions use the signed Stream upload in the contributor workspace.");
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Photo library permission is required to attach an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
      allowsEditing: false,
    });
    if (!result.canceled) setSelectedMedia(result.assets[0] ?? null);
  };

  const submit = async () => {
    if (!auth.session) { setMessage("Sign in with a contributor account before submitting."); return; }
    if (!title.trim()) { setMessage("A title is required."); return; }
    if (kind === "video") { setMessage("Video uploads are not available in the native picker yet. Submit video from the web media studio."); return; }
    if (!selectedMedia) { setMessage("Choose an image before submitting."); return; }
    setSaving(true);
    setMessage(null);
    const payload = {
      kind,
      title: title.trim(),
      description: caption.trim(),
      caption: caption.trim(),
      city: city.trim() || undefined,
      subjectTags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      culturalTags: [],
      rightsStatus: rights,
      modelReleaseStatus: "unknown",
      propertyReleaseStatus: "unknown",
      monetizationModel: "membership",
      artistLicenseKey: "cc_by_4_0",
      artistLicenseVersion: "4.0",
      artistLicenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    };
    let currentDraftId = draftId;
    const creating = !currentDraftId;
    try {
      let response: { status: number; body: { id?: string; error?: string } | null };
      if (currentDraftId) {
        response = await apiRequest<{ id?: string; error?: string }>(`/api/assets/${encodeURIComponent(currentDraftId)}`, auth.session, { method: "PATCH", body: payload });
      } else {
        response = await apiPost<{ id?: string; error?: string }>("/api/assets", payload, auth.session);
      }
      if (!currentDraftId && response.status === 201 && response.body?.id) {
        currentDraftId = response.body.id;
        setDraftId(currentDraftId);
      }
      if ((creating && response.status === 201) || (!creating && response.status === 200)) {
        if (!currentDraftId) { setMessage("The draft was created without an id. Nothing was uploaded; try again safely."); return; }
      const mediaType = selectedMedia.mimeType ?? "image/jpeg";
      const fileResponse = await fetch(selectedMedia.uri);
      const mediaBlob = await fileResponse.blob();
      let currentUploadKey = uploadIdempotencyKey;
      let upload = await apiPost<{ uploadId?: string; uploadUrl?: string; error?: string }>("/api/uploads", {
        filename: selectedMedia.fileName ?? `veld-${Date.now()}.jpg`,
        contentType: mediaType,
        sizeBytes: selectedMedia.fileSize ?? mediaBlob.size,
        assetId: currentDraftId,
        idempotencyKey: currentUploadKey,
      }, auth.session);
      if (upload.status === 409 && upload.body?.error?.includes("failed or expired")) {
        currentUploadKey = newUploadIdempotencyKey();
        setUploadIdempotencyKey(currentUploadKey);
        upload = await apiPost<{ uploadId?: string; uploadUrl?: string; error?: string }>("/api/uploads", {
          filename: selectedMedia.fileName ?? `veld-${Date.now()}.jpg`,
          contentType: mediaType,
          sizeBytes: selectedMedia.fileSize ?? mediaBlob.size,
          assetId: currentDraftId,
          idempotencyKey: currentUploadKey,
        }, auth.session);
      }
      if (![200, 201].includes(upload.status) || !upload.body?.uploadId || !upload.body.uploadUrl) {
        setMessage(upload.body?.error ?? "The media upload session could not be created.");
        setSaving(false);
        return;
      }
      const putResponse = await fetch(upload.body.uploadUrl, { method: "PUT", headers: { "Content-Type": mediaType }, body: mediaBlob });
      if (!putResponse.ok) { setMessage("The media upload failed before completion."); setSaving(false); return; }
      const completion = await apiPost<{ error?: string }>(`/api/uploads/${upload.body.uploadId}/complete`, {}, auth.session);
      if (completion.status >= 300) { setMessage(completion.body?.error ?? "The media upload could not be completed."); setSaving(false); return; }
      setMessage("Draft submitted for editorial review.");
      setTitle(""); setCaption(""); setCity(""); setTags(""); setSelectedMedia(null);
      setDraftId("");
      setUploadIdempotencyKey(newUploadIdempotencyKey());
      setSaving(false);
      } else if (response.status === 401 || response.status === 403) {
        setMessage("Sign in with a contributor account to submit assets.");
      } else {
        setMessage(response.body?.error ?? "The draft could not be submitted.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? `Upload could not be completed. Your draft is still safe to retry. ${error.message}` : "Upload could not be completed. Your draft is still safe to retry.");
    } finally {
      setSaving(false);
    }
  };

  if (auth.loading && !auth.session) return <ScrollView contentContainerStyle={styles.scrollContent}><Text style={styles.eyebrow}>CONTRIBUTE</Text><Text style={styles.screenTitle}>Add to the archive</Text><LoadingState label="Restoring contributor access" /></ScrollView>;

  if (!auth.session) return <SellerAccess auth={auth} initialMode={initialAuthMode} />;

  if (auth.session.user.role === "buyer") return <MobileBuyerHome session={auth.session} />;

  if (!["contributor", "editor", "admin"].includes(auth.session.user.role)) return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>CONTRIBUTE</Text><Text style={styles.screenTitle}>Contributor access required</Text>
      <View style={styles.accountCard}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{auth.session.user.displayName}</Text><Text style={styles.cardMeta}>{auth.session.user.email} · {auth.session.user.role}</Text></View><Pressable onPress={() => void auth.signOut()}><LogOut color={COLORS.muted} size={19} /></Pressable></View>
      <View style={styles.notice}><ShieldCheck color={COLORS.amber} size={18} /><Text style={styles.noticeText}>This account is signed in but does not have contributor permissions. Ask an archive administrator to add the contributor role.</Text></View>
    </ScrollView>
  );

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>CONTRIBUTE</Text>
      <Text style={styles.screenTitle}>{section === "onboarding" ? "Seller workspace" : "Add to the archive"}</Text>
      <Text style={styles.screenIntro}>{section === "onboarding" ? "Complete the evidence needed to sell, then track approval here." : "Prepare metadata and media for editorial review."}</Text>
      <View style={styles.accountCard}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{auth.session.user.displayName}</Text><Text style={styles.cardMeta}>{auth.session.user.organizationName} · {auth.session.user.role}</Text></View><Pressable accessibilityLabel="Sign out" onPress={() => void auth.signOut()}><LogOut color={COLORS.muted} size={19} /></Pressable></View>
      <View style={styles.workspaceToggle}><Pressable style={[styles.workspaceToggleButton, section === "onboarding" && styles.workspaceToggleActive]} onPress={() => setSection("onboarding")}><Text style={[styles.workspaceToggleText, section === "onboarding" && styles.stepTextActive]}>Onboarding</Text></Pressable><Pressable style={[styles.workspaceToggleButton, section === "upload" && styles.workspaceToggleActive]} onPress={() => setSection("upload")}><Text style={[styles.workspaceToggleText, section === "upload" && styles.stepTextActive]}>Upload</Text></Pressable><Pressable style={[styles.workspaceToggleButton, section === "library" && styles.workspaceToggleActive]} onPress={() => setSection("library")}><Text style={[styles.workspaceToggleText, section === "library" && styles.stepTextActive]}>Library</Text></Pressable></View>
      {section === "onboarding" ? <SellerOnboarding session={auth.session} /> : section === "library" ? <SellerLibrary session={auth.session} /> : <>
      <Pressable style={styles.uploadDropzone} onPress={() => void pickMedia()}><UploadCloud color={COLORS.green} size={28} /><Text style={styles.dropzoneTitle}>{selectedMedia?.fileName ?? "Choose an image"}</Text><Text style={styles.dropzoneMeta}>{selectedMedia ? `${Math.round((selectedMedia.fileSize ?? 0) / 1024)} KB selected` : "Open photo library"}</Text></Pressable>
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Give this moment a name" />
      <Field label="Caption" value={caption} onChangeText={setCaption} placeholder="Add useful context" multiline />
      <Field label="City" value={city} onChangeText={setCity} placeholder="Where was this made?" />
      <Field label="Subject tags" value={tags} onChangeText={setTags} placeholder="Separate tags with commas" />
      <Text style={styles.fieldLabel}>Media type</Text>
      <View style={styles.segmentRow}>{(["image", "video"] as const).map((value) => <Pressable key={value} style={[styles.segment, kind === value && styles.segmentActive]} onPress={() => setKind(value)}>{value === "image" ? <ImageIcon color={kind === value ? COLORS.surface : COLORS.muted} size={15} /> : <Video color={kind === value ? COLORS.surface : COLORS.muted} size={15} />}<Text style={[styles.segmentText, kind === value && styles.segmentTextActive]}>{value === "image" ? "Image" : "Video"}</Text></Pressable>)}</View>
      <Text style={styles.fieldLabel}>Rights status</Text>
      <View style={styles.segmentRow}>{["verified", "pending"].map((value) => <Pressable key={value} style={[styles.segment, rights === value && styles.segmentActive]} onPress={() => setRights(value)}><ShieldCheck color={rights === value ? COLORS.surface : COLORS.muted} size={15} /><Text style={[styles.segmentText, rights === value && styles.segmentTextActive]}>{value === "verified" ? "Verified" : "Pending"}</Text></Pressable>)}</View>
      {message ? <View style={styles.notice}><CheckCircle2 color={message.includes("could") || message.includes("required") || message.includes("Sign") ? COLORS.amber : COLORS.green} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}
      <Pressable style={[styles.primaryButton, saving && styles.disabledButton]} disabled={saving} onPress={() => void submit()}>{saving ? <ActivityIndicator color={COLORS.surface} /> : <><FilePlus2 color={COLORS.surface} size={17} /><Text style={styles.primaryButtonText}>Submit for review</Text></>}</Pressable>
      </>}
    </ScrollView>
  );
}

function CommunityScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<CommunityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setError(null); try { setData(await apiGet<CommunityOverview>("/api/community/overview")); } catch { setError("Community spaces are temporarily unavailable."); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <Pressable onPress={onBack}><Text style={styles.sectionAction}>← More</Text></Pressable><Text style={styles.eyebrow}>COMMUNITY & COLLECTIONS</Text><Text style={styles.screenTitle}>Make the archive with us</Text><Text style={styles.screenIntro}>Contributor forums, editorial showcases, and region-led collections keep the people and places behind the work visible.</Text>
    {!data && !error ? <LoadingState label="Loading community spaces" /> : error ? <ErrorState message={error} onRetry={load} /> : <>
      <SectionHeader title="Contributor forums" action="Moderated" onPress={() => undefined} />
      <View style={styles.stack}>{data?.forums.map((forum) => <View key={forum.id} style={styles.listCard}><Text style={styles.cardTitle}>{forum.name}</Text><Text style={styles.cardMeta}>{forum.description}</Text><Text style={styles.cardKind}>{forum.topicCount} TOPICS · {forum.postCount} POSTS</Text></View>)}</View>
      <SectionHeader title="Discussions" action="Read" onPress={() => undefined} />
      <View style={styles.stack}>{data?.threads.map((thread) => <View key={thread.id} style={styles.listCard}><Text style={styles.cardKind}>{thread.featured ? "FEATURED" : "DISCUSSION"}</Text><Text style={styles.cardTitle}>{thread.title}</Text><Text style={styles.cardMeta}>{thread.excerpt}</Text><Text style={styles.cardMeta}>{thread.author} · {thread.replies} replies · {thread.lastActivity}</Text></View>)}</View>
      <SectionHeader title="Editorial showcases" action="Curated" onPress={() => undefined} />
      <View style={styles.stack}>{data?.showcases.map((showcase) => <View key={showcase.id} style={styles.featureCard}><Text style={styles.cardKind}>{showcase.theme.toUpperCase()}</Text><Text style={styles.cardTitle}>{showcase.title}</Text><Text style={styles.cardMeta}>{showcase.description}</Text><Text style={styles.cardMeta}>Curated by {showcase.curator}</Text></View>)}</View>
      <SectionHeader title="Featured collections" action="South Africa" onPress={() => undefined} />
      <View style={styles.stack}>{data?.collections.map((collection) => <View key={collection.id} style={styles.listCard}><Text style={styles.cardKind}>{collection.featuredLabel}</Text><Text style={styles.cardTitle}>{collection.title}</Text><Text style={styles.cardMeta}>{collection.description}</Text><Text style={styles.cardMeta}>{collection.location} · {collection.assetCount} assets · {collection.contributorCount} contributors</Text></View>)}</View>
    </>}
  </ScrollView>;
}

function CreatorsScreen({ onBack, onOpenAsset }: { onBack: () => void; onOpenAsset: (asset: Asset) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreatorProfile[]>([]);
  const [selected, setSelected] = useState<{ profile: CreatorProfile; assets: Asset[]; collections: Array<{ id: string; title: string; description: string; assetCount: number }> } | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { const response = await apiGet<{ results: CreatorProfile[] }>(`/api/creators?${queryString({ q: query.trim() || undefined })}`); setResults(response.results); } catch { setResults([]); } finally { setLoading(false); } }, [query]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 250); return () => clearTimeout(timer); }, [load]);
  const openCreator = async (slug: string) => { try { setSelected(await apiGet(`/api/creators/${encodeURIComponent(slug)}`)); } catch { Alert.alert("Creator unavailable", "This public portfolio could not be loaded."); } };
  if (selected) return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}><Pressable onPress={() => setSelected(null)}><Text style={styles.sectionAction}>← All creators</Text></Pressable><Text style={styles.eyebrow}>{selected.profile.location || "SOUTH AFRICA"}</Text><Text style={styles.screenTitle}>{selected.profile.name}</Text><Text style={styles.screenIntro}>{selected.profile.headline}</Text><Text style={styles.bodyText}>{selected.profile.bio}</Text><View style={styles.tagWrap}>{selected.profile.specialties.map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View><View style={styles.statGrid}><Fact label="Published" value={String(selected.profile.assetCount)} /><Fact label="Photos" value={String(selected.profile.publishedImageCount)} /><Fact label="Collections" value={String(selected.profile.collectionCount)} /></View><SectionHeader title="Portfolio collections" action={`${selected.collections.length}`} onPress={() => undefined} /><View style={styles.stack}>{selected.collections.map((collection) => <View style={styles.listCard} key={collection.id}><Text style={styles.cardTitle}>{collection.title}</Text><Text style={styles.cardMeta}>{collection.description}</Text><Text style={styles.cardKind}>{collection.assetCount} ASSETS</Text></View>)}</View><SectionHeader title="Published work" action={`${selected.assets.length}`} onPress={() => undefined} /><View style={styles.assetGrid}>{selected.assets.map((asset) => <AssetCard key={asset.id} asset={asset} onPress={() => onOpenAsset(asset)} />)}</View></ScrollView>;
  return <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><Pressable onPress={onBack}><Text style={styles.sectionAction}>← More</Text></Pressable><Text style={styles.eyebrow}>CREATOR MARKETPLACE</Text><Text style={styles.screenTitle}>People behind the work</Text><Text style={styles.screenIntro}>Search approved public portfolios by person, place, and specialty.</Text><Field label="Search creators" value={query} onChangeText={setQuery} placeholder="Name, place, or specialty" />{loading ? <LoadingState label="Finding creators" /> : results.length ? <View style={styles.stack}>{results.map((creator) => <Pressable key={creator.id} style={styles.navigationCard} onPress={() => void openCreator(creator.slug)}><View style={styles.creatorAvatar}><Text style={styles.creatorAvatarText}>{creator.name.slice(0, 1)}</Text></View><View style={styles.navigationCopy}><Text style={styles.cardKind}>{creator.location || "SOUTH AFRICA"}</Text><Text style={styles.cardTitle}>{creator.name}</Text><Text style={styles.cardMeta}>{creator.headline}</Text><Text style={styles.cardMeta}>{creator.assetCount} assets · {creator.collectionCount} collections</Text></View><ChevronRight color={COLORS.muted} size={18} /></Pressable>)}</View> : <EmptyState label="No public creators matched" />}</ScrollView>;
}

function AnalyticsScreen({ session, onBack }: { session: MobileApiSession; onBack: () => void }) {
  const role = session.user.role === "buyer" ? "buyer" : "contributor";
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { const response = await apiRequest<Record<string, any>>(`/api/analytics/${role}`, session); if (response.status === 200) { setData(response.body); setError(null); } else { setData(null); setError(response.status === 402 ? "A buyer subscription is required for ROI analytics." : "Analytics are unavailable. No cached figures are shown."); } }, [role, session]);
  useEffect(() => { void load(); }, [load]);
  const summary = data?.summary ?? {};
  const metrics = role === "buyer" ? [["Spend", `R${Math.round(Number(summary.spendCents ?? 0) / 100).toLocaleString("en-ZA")}`], ["Licensed assets", summary.licensedAssets], ["ROI", `${summary.roi ?? 0}%`], ["Conversions", summary.conversions]] : [["Searches", summary.searches], ["Views", summary.views], ["Saved", summary.saves], ["Demand change", `${summary.demandChange ?? 0}%`]];
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}><Pressable onPress={onBack}><Text style={styles.sectionAction}>← More</Text></Pressable><Text style={styles.eyebrow}>{role === "buyer" ? "BUYER ROI" : "CONTRIBUTOR INSIGHTS"}</Text><Text style={styles.screenTitle}>{role === "buyer" ? "Licence performance" : "What buyers need"}</Text><Text style={styles.screenIntro}>Privacy-conscious aggregate signals from the same reporting API as desktop.</Text>{error ? <ErrorState message={error} onRetry={load} /> : !data ? <LoadingState label="Loading insights" /> : <><View style={styles.metricGrid}>{metrics.map(([label, value]) => <View key={String(label)} style={styles.metricCard}><Text style={styles.cardKind}>{label}</Text><Text style={styles.metricValue}>{String(value ?? 0)}</Text></View>)}</View>{role === "contributor" ? <View style={styles.stack}>{(data.opportunities ?? []).map((item: { title: string; detail: string }) => <View key={item.title} style={styles.featureCard}><Text style={styles.cardKind}>OPPORTUNITY</Text><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardMeta}>{item.detail}</Text></View>)}</View> : <View style={styles.stack}>{(data.campaigns ?? []).map((campaign: { id: string; name: string; assetTitle: string; roi: number }) => <View key={campaign.id} style={styles.listCard}><Text style={styles.cardTitle}>{campaign.name}</Text><Text style={styles.cardMeta}>{campaign.assetTitle}</Text><Text style={styles.cardKind}>ROI {campaign.roi}%</Text></View>)}</View>}</>}</ScrollView>;
}

function AccountScreen({ auth, onBack, onSell, onSignIn }: { auth: MobileAuth; onBack: () => void; onSell: () => void; onSignIn: () => void }) {
  const [account, setAccount] = useState<AccountLifecycle | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [licences, setLicences] = useState<BuyerLicenceRecord[]>([]);
  const [subscription, setSubscription] = useState<Record<string, any> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const session = auth.session;
  const load = useCallback(async () => {
    if (!session) return;
    const [accountResponse, notificationResponse, licenceResponse, subscriptionResponse] = await Promise.all([
      apiRequest<AccountLifecycle>("/api/account/lifecycle", session),
      apiRequest<{ results: AppNotification[] }>("/api/notifications", session),
      apiRequest<{ results: BuyerLicenceRecord[] }>("/api/my/licences", session),
      ["buyer", "admin"].includes(session.user.role) ? apiRequest<Record<string, any>>("/api/subscription", session) : Promise.resolve({ status: 403, body: null }),
    ]);
    setAccount(accountResponse.status === 200 ? accountResponse.body : null);
    setNotifications(notificationResponse.body?.results ?? []);
    setLicences(licenceResponse.body?.results ?? []);
    setSubscription(subscriptionResponse.status === 200 ? subscriptionResponse.body : null);
  }, [session]);
  useEffect(() => { void load(); }, [load]);
  if (!session) return <ScrollView contentContainerStyle={styles.scrollContent}><Pressable onPress={onBack}><Text style={styles.sectionAction}>← More</Text></Pressable><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.screenTitle}>Sign in to continue</Text><Text style={styles.screenIntro}>Sign in to view your profile, account controls, alerts, and licence history.</Text><Pressable style={styles.primaryButton} onPress={onSignIn}><LogIn color={COLORS.surface} size={17} /><Text style={styles.primaryButtonText}>Sign in</Text></Pressable><Pressable style={styles.secondaryButton} onPress={onSell}><Text style={styles.secondaryButtonText}>Create a seller account</Text></Pressable></ScrollView>;
  const updatePreferences = async (next: Pick<AccountLifecycle, "emailNotifications" | "productNotifications">) => { const response = await apiRequest<{ error?: string }>("/api/account/preferences", session, { method: "PUT", body: next }); setMessage(response.status === 200 ? "Notification preferences saved." : messageFrom(response.body, "Preferences could not be saved.")); await load(); };
  const requestExport = async () => { const response = await apiRequest<{ error?: string }>("/api/account/exports", session, { method: "POST", body: {} }); setMessage(response.status < 300 ? "Account export requested." : messageFrom(response.body, "Export could not be requested.")); await load(); };
  const scheduleDeletion = () => Alert.alert("Schedule account deletion?", "The account enters a 30-day recovery window before deletion.", [{ text: "Cancel", style: "cancel" }, { text: "Schedule deletion", style: "destructive", onPress: () => { void apiRequest("/api/account/deletion", session, { method: "POST", body: {} }).then(async () => { setMessage("Account deletion scheduled."); await load(); }); } }]);
  const markRead = async (id: string) => { await apiRequest(`/api/notifications/${encodeURIComponent(id)}/read`, session, { method: "POST", body: {} }); await load(); };
  const startSubscription = async () => { const response = await apiRequest<{ checkoutUrl?: string; error?: string }>("/api/subscription/session", session, { method: "POST", body: { successUrl: `${API_BASE_URL}/account?subscription=success`, cancelUrl: `${API_BASE_URL}/account?subscription=cancelled` } }); if (response.status === 201 && response.body?.checkoutUrl) await Linking.openURL(response.body.checkoutUrl); else setMessage(messageFrom(response.body, "Paystack checkout could not be started.")); };
  const manageSubscription = async () => { const response = await apiRequest<{ manageUrl?: string; error?: string }>("/api/subscription/manage-link", session, { method: "POST", body: {} }); if (response.status === 200 && response.body?.manageUrl) await Linking.openURL(response.body.manageUrl); else setMessage(messageFrom(response.body, "Subscription management is unavailable.")); };
  const continueLicencePayment = async (licence: BuyerLicenceRecord) => { const response = await apiRequest<{ checkoutUrl?: string; error?: string }>(`/api/payments/${encodeURIComponent(licence.id)}/session`, session, { method: "POST", body: { successUrl: `${API_BASE_URL}/buyer?licence=${encodeURIComponent(licence.id)}&payment=complete`, cancelUrl: `${API_BASE_URL}/buyer?licence=${encodeURIComponent(licence.id)}&payment=cancelled` } }); if (response.status === 201 && response.body?.checkoutUrl) await Linking.openURL(response.body.checkoutUrl); else setMessage(`The pending licence is safe. ${response.body?.error ?? "Paystack checkout could not be opened."}`); };
  const openLicensedOriginal = async (licence: BuyerLicenceRecord) => { if (!licence.originalUrl) { setMessage("The paid original is still being prepared."); return; } const response = await fetch(`${API_BASE_URL}${licence.originalUrl}`, { headers: mobileSessionHeaders(session), redirect: "follow" }); if (!response.ok) { const body = await response.json().catch(() => null) as { error?: string } | null; setMessage(body?.error ?? "The licensed original is unavailable."); return; } await Linking.openURL(response.url); };
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}><Pressable onPress={onBack}><Text style={styles.sectionAction}>← More</Text></Pressable><Text style={styles.eyebrow}>ACCOUNT & ORGANISATION</Text><Text style={styles.screenTitle}>Control your account</Text><View style={styles.accountCard}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{session.user.displayName}</Text><Text style={styles.cardMeta}>{session.user.email} · {session.user.organizationName} · {session.user.role}</Text></View><Pressable accessibilityLabel="Sign out" onPress={() => void auth.signOut()}><LogOut color={COLORS.muted} size={19} /></Pressable></View>{message ? <View style={styles.notice}><CheckCircle2 color={COLORS.green} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}{!account ? <LoadingState label="Loading account controls" /> : <>
    <View style={styles.formCard}><Text style={styles.cardKind}>IDENTITY SECURITY</Text><Text style={styles.cardTitle}>Email, password and MFA</Text><Text style={styles.cardMeta}>{account.emailVerified ? "Email verified." : "Email verification required."} {account.mfaEnrolled ? "MFA enrolled." : "MFA not enrolled."}</Text>{account.accountPortalUrl ? <Pressable style={styles.secondaryButton} onPress={() => void Linking.openURL(account.accountPortalUrl ?? "")}><Text style={styles.secondaryButtonText}>Manage identity security</Text></Pressable> : null}</View>
    <View style={styles.formCard}><Text style={styles.cardKind}>NOTIFICATIONS</Text><Text style={styles.cardTitle}>Keep only useful alerts</Text><CheckField checked={account.emailNotifications} onPress={() => void updatePreferences({ emailNotifications: !account.emailNotifications, productNotifications: account.productNotifications })} label="Essential email notifications" /><CheckField checked={account.productNotifications} onPress={() => void updatePreferences({ emailNotifications: account.emailNotifications, productNotifications: !account.productNotifications })} label="Product and marketplace updates" /></View>
    <View style={styles.formCard}><Text style={styles.cardKind}>YOUR DATA</Text><Text style={styles.cardTitle}>Export or delete</Text><Text style={styles.cardMeta}>Export: {account.exportStatus} · deletion: {account.deletionStatus}</Text><Pressable style={styles.secondaryButton} onPress={() => void requestExport()}><Text style={styles.secondaryButtonText}>Request account export</Text></Pressable><Pressable style={styles.dangerButton} onPress={scheduleDeletion}><Text style={styles.dangerButtonText}>Schedule deletion</Text></Pressable></View>
  </>}
  {subscription ? <View style={styles.formCard}><Text style={styles.cardKind}>BUYER SUBSCRIPTION</Text><Text style={styles.cardTitle}>Archive access · {String(subscription.subscription?.status ?? "not started").replaceAll("_", " ")}</Text><Text style={styles.cardMeta}>{subscription.plan ? `R${Math.round(Number(subscription.plan.amountCents ?? 0) / 100).toLocaleString("en-ZA")} / ${String(subscription.plan.interval)}. Paystack webhook events are the source of truth.` : "The Paystack plan is not configured."}</Text>{subscription.configured && !subscription.subscription ? <Pressable style={styles.primaryButton} onPress={() => void startSubscription()}><Text style={styles.primaryButtonText}>Continue with Paystack</Text></Pressable> : null}{subscription.subscription?.provider_subscription_code ? <Pressable style={styles.secondaryButton} onPress={() => void manageSubscription()}><Text style={styles.secondaryButtonText}>Manage billing</Text></Pressable> : null}</View> : null}
  <SectionHeader title="Alerts" action={`${notifications.filter((item) => !item.read_at).length} unread`} onPress={() => undefined} /><View style={styles.stack}>{notifications.length ? notifications.slice(0, 10).map((item) => <View key={item.id} style={styles.listCard}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardMeta}>{item.body}</Text><Text style={styles.cardMeta}>{new Date(item.created_at).toLocaleDateString("en-ZA")}</Text>{!item.read_at ? <Pressable onPress={() => void markRead(item.id)}><Text style={styles.sectionAction}>Mark read</Text></Pressable> : null}</View>) : <Text style={styles.stateText}>No alerts yet.</Text>}</View>
  <SectionHeader title="Licences & delivery" action={`${licences.length}`} onPress={() => void load()} /><View style={styles.stack}>{licences.length ? licences.slice(0, 20).map((licence) => <View key={licence.id} style={styles.listCard}><View style={styles.cardLabelRow}><Text style={styles.cardKind}>{licence.status.toUpperCase()}</Text><Text style={styles.cardKind}>{formatZar(licence.priceCents)}</Text></View><Text style={styles.cardTitle}>{licence.assetTitle}</Text><Text style={styles.cardMeta}>{licence.licenceType} · {licence.territory} · {licence.durationDays} days · approval {licence.approvalStatus}</Text>{licence.status === "pending" ? <Pressable style={styles.secondaryButton} onPress={() => void continueLicencePayment(licence)}><Text style={styles.secondaryButtonText}>Continue payment</Text></Pressable> : licence.status === "paid" ? <Pressable style={styles.secondaryButton} onPress={() => void openLicensedOriginal(licence)}><Text style={styles.secondaryButtonText}>Open licensed original</Text></Pressable> : null}</View>) : <Text style={styles.stateText}>No licences yet. Open an asset and choose Licence media.</Text>}</View>
  </ScrollView>;
}

function CampaignsScreen({ session, onBack, onOpenAsset }: { session: MobileApiSession; onBack: () => void; onOpenAsset: (asset: Asset) => void }) {
  const [campaigns, setCampaigns] = useState<Array<Record<string, any>>>([]);
  const [selected, setSelected] = useState<Record<string, any> | null>(null);
  const [name, setName] = useState("");
  const [briefText, setBriefText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { const response = await apiRequest<{ results?: Array<Record<string, any>> }>("/api/campaigns", session); setCampaigns(response.body?.results ?? []); }, [session]);
  useEffect(() => { void load(); }, [load]);
  const open = async (id: string) => { const response = await apiRequest<Record<string, any>>(`/api/campaigns/${encodeURIComponent(id)}`, session); if (response.status === 200) setSelected(response.body); else setMessage("That campaign could not be loaded."); };
  const create = async () => { if (name.trim().length < 3 || briefText.trim().length < 10) { setMessage("Add a campaign name and a useful brief."); return; } setSaving(true); const response = await apiRequest<{ id?: string; error?: string }>("/api/campaigns", session, { method: "POST", body: { name: name.trim(), briefText: briefText.trim(), brief: {}, brandKit: { colours: [], logoNotes: "", tone: "", industry: "", forbiddenStyles: [], preferredVisuals: "" } } }); setSaving(false); if (response.status !== 201 || !response.body?.id) { setMessage(messageFrom(response.body, "Campaign could not be created.")); return; } setName(""); setBriefText(""); await load(); await open(response.body.id); setMessage("Campaign board created with rights-aware recommendations."); };
  const stage = async (assetId: string, value: "shortlisted" | "approved" | "needs_review" | "rejected") => { if (!selected?.campaign?.id) return; const response = await apiRequest<{ error?: string }>(`/api/campaigns/${encodeURIComponent(selected.campaign.id)}/assets`, session, { method: "POST", body: { assetId, stage: value, note: value === "approved" ? "Approved from the mobile workspace after rights review." : "" } }); setMessage(response.status === 200 ? `Asset marked ${value.replaceAll("_", " ")}.` : messageFrom(response.body, "Campaign decision was not saved.")); if (response.status === 200) await open(selected.campaign.id); };
  if (selected) { const rows = selected.recommendations ?? selected.assets ?? []; return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}><Pressable onPress={() => setSelected(null)}><Text style={styles.sectionAction}>← Campaigns</Text></Pressable><Text style={styles.eyebrow}>CAMPAIGN INTELLIGENCE</Text><Text style={styles.screenTitle}>{String(selected.campaign?.name ?? "Campaign")}</Text><Text style={styles.screenIntro}>{String(selected.campaign?.briefText ?? selected.campaign?.brief ?? "Rights-aware campaign board")}</Text>{message ? <View style={styles.notice}><ShieldCheck color={COLORS.green} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}<View style={styles.stack}>{rows.map((row: Record<string, any>) => { const asset = (row.asset ?? row) as Asset; return <View key={asset.id} style={styles.listCard}><Pressable onPress={() => onOpenAsset(asset)}><Text style={styles.cardKind}>{String(row.stage ?? row.campaignStage ?? "recommended").replaceAll("_", " ")}</Text><Text style={styles.cardTitle}>{asset.title}</Text><Text style={styles.cardMeta}>{String(row.reason ?? row.explanation ?? "Matched to the campaign brief")}</Text></Pressable><View style={styles.actionRow}>{(["shortlisted", "approved", "needs_review", "rejected"] as const).map((value) => <Pressable key={value} style={styles.smallAction} onPress={() => void stage(asset.id, value)}><Text style={styles.smallActionText}>{value.replaceAll("_", " ")}</Text></Pressable>)}</View></View>; })}</View></ScrollView>; }
  return <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><Pressable onPress={onBack}><Text style={styles.sectionAction}>← More</Text></Pressable><Text style={styles.eyebrow}>CAMPAIGN INTELLIGENCE</Text><Text style={styles.screenTitle}>Brief the story</Text><Text style={styles.screenIntro}>Create a campaign board, inspect explainable recommendations, and record approval stages.</Text><View style={styles.formCard}><Field label="Campaign name" value={name} onChangeText={setName} placeholder="Campaign or client" /><Field label="Brief" value={briefText} onChangeText={setBriefText} placeholder="Audience, place, channels, story, and rights needed" multiline /><Pressable style={[styles.primaryButton, saving && styles.disabledButton]} disabled={saving} onPress={() => void create()}>{saving ? <ActivityIndicator color={COLORS.surface} /> : <Text style={styles.primaryButtonText}>Create campaign board</Text>}</Pressable></View>{message ? <View style={styles.notice}><ShieldCheck color={COLORS.amber} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}<SectionHeader title="Campaigns" action={`${campaigns.length}`} onPress={() => void load()} /><View style={styles.stack}>{campaigns.map((campaign) => <Pressable style={styles.navigationCard} key={String(campaign.id)} onPress={() => void open(String(campaign.id))}><View style={styles.navigationCopy}><Text style={styles.cardTitle}>{String(campaign.name)}</Text><Text style={styles.cardMeta}>{String(campaign.status ?? "draft")} · {Number(campaign.assetCounts?.approved ?? 0)} approved</Text></View><ChevronRight color={COLORS.muted} size={18} /></Pressable>)}</View></ScrollView>;
}

function GovernanceScreen({ session, onBack, onOpenAsset }: { session: MobileApiSession; onBack: () => void; onOpenAsset: (asset: Asset) => void }) {
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); const response = await apiRequest<{ results?: Asset[]; error?: string }>("/api/governance/assets?stage=all", session); setItems(response.body?.results ?? []); if (response.status !== 200) setMessage(messageFrom(response.body, "The governance queue is unavailable.")); setLoading(false); }, [session]);
  useEffect(() => { void load(); }, [load]);
  const act = async (asset: Asset, action: "approve" | "reject") => { const response = await apiRequest<{ error?: string }>(`/api/governance/assets/${encodeURIComponent(asset.id)}/action`, session, { method: "POST", body: { action } }); setMessage(response.status === 200 ? `${asset.title} marked ${action}.` : messageFrom(response.body, "The review action was blocked.")); if (response.status === 200) await load(); };
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}><Pressable onPress={onBack}><Text style={styles.sectionAction}>← More</Text></Pressable><Text style={styles.eyebrow}>EDITORIAL GOVERNANCE</Text><Text style={styles.screenTitle}>Review what is real</Text><Text style={styles.screenIntro}>Evidence, place, rights, consent, confidence, and workflow stage remain visible before publication. AI enrichment runs once after upload; later changes require an explicit human correction in the desktop review workspace.</Text>{message ? <View style={styles.notice}><ShieldCheck color={message.includes("marked") ? COLORS.green : COLORS.amber} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}{loading ? <LoadingState label="Loading review queue" /> : items.length ? <View style={styles.stack}>{items.map((asset) => <View key={asset.id} style={styles.listCard}><Pressable onPress={() => onOpenAsset(asset)}><Text style={styles.cardKind}>{asset.status.replaceAll("_", " ")} · RIGHTS {asset.rightsStatus ?? "pending"}</Text><Text style={styles.cardTitle}>{asset.title}</Text><Text style={styles.cardMeta}>{locationFor(asset)} · confidence {confidenceFor(asset)}%</Text></Pressable><View style={styles.actionRow}><Pressable style={styles.smallAction} onPress={() => onOpenAsset(asset)}><Text style={styles.smallActionText}>Evidence</Text></Pressable><Pressable style={styles.smallAction} onPress={() => void act(asset, "approve")}><Text style={styles.smallActionText}>Approve</Text></Pressable><Pressable style={styles.smallAction} onPress={() => void act(asset, "reject")}><Text style={styles.smallActionText}>Reject</Text></Pressable></View></View>)}</View> : <EmptyState label="No records are waiting for review" />}</ScrollView>;
}

type MoreView = "menu" | "account" | "community" | "creators" | "insights" | "campaigns" | "governance" | "rights" | "status" | "advanced-search" | "marketplace" | "operations";
function MoreScreen({ initialView = "menu", auth, onOpenAsset, onSell, onSignIn }: { initialView?: MoreView; auth: MobileAuth; onOpenAsset: (asset: Asset) => void; onSell: () => void; onSignIn: () => void }) {
  const [view, setView] = useState<MoreView>(initialView);
  if (view === "account") return <AccountScreen auth={auth} onBack={() => setView("menu")} onSell={onSell} onSignIn={onSignIn} />;
  if (view === "community") return <CommunityActionsScreen session={auth.session} onBack={() => setView("menu")} />;
  if (view === "creators") return <CreatorsScreen onBack={() => setView("menu")} onOpenAsset={onOpenAsset} />;
  if (view === "insights" && auth.session) return <AnalyticsScreen session={auth.session} onBack={() => setView("menu")} />;
  if (view === "campaigns" && auth.session) return <CampaignDeliveryScreen session={auth.session} onBack={() => setView("menu")} />;
  if (view === "governance" && auth.session && ["editor", "admin"].includes(auth.session.user.role)) return <GovernanceEditorScreen session={auth.session} onBack={() => setView("menu")} />;
  if (view === "advanced-search") return <AdvancedSearchScreen onBack={() => setView("menu")} onOpenAsset={(asset) => onOpenAsset(asset as Asset)} />;
  if (view === "marketplace" && auth.session) return <MarketplaceParityScreen session={auth.session} onBack={() => setView("menu")} />;
  if (view === "operations") return <OperationsScreen session={auth.session} onBack={() => setView("menu")} />;
  if (view === "rights") return <ScrollView contentContainerStyle={styles.scrollContent}><Pressable onPress={() => setView("menu")}><Text style={styles.sectionAction}>← More</Text></Pressable><Text style={styles.eyebrow}>RIGHTS GUIDE</Text><Text style={styles.screenTitle}>Context before consequence</Text><Text style={styles.screenIntro}>Every consequential request should be checked against copyright ownership, permitted use, territory, duration, model releases, property releases, cultural context, and human editorial verification.</Text><View style={styles.stack}>{[["Copyright", "Confirm who owns or controls the work and which licence governs it."], ["People", "Commercial use may require a verified model release; editorial use still needs truthful context."], ["Property", "Recognisable private property, artwork, and trademarks can require additional permission."], ["Provenance", "Keep source, creator attribution, review state, and evidence visible before licensing."], ["Resolution", "Use the Community workspace on desktop to lodge a structured takedown or mediation case."]].map(([title, detail]) => <View style={styles.listCard} key={title}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardMeta}>{detail}</Text></View>)}</View></ScrollView>;
  if (view === "status") return <StatusScreen onBack={() => setView("menu")} />;
  const canGovern = auth.session && ["editor", "admin"].includes(auth.session.user.role);
  const items: Array<{ key: MoreView; title: string; detail: string; gated?: boolean }> = [{ key: "account", title: "Account", detail: "Security, billing, alerts, exports, deletion, and licences." }, { key: "advanced-search", title: "Advanced search", detail: "Province, category, media type, and human-review filters." }, { key: "community", title: "Community & rights", detail: "Forums, discussions, rights cases, and mediation intake." }, { key: "creators", title: "Creator marketplace", detail: "Search public portfolios and published work." }, { key: "marketplace", title: "Marketplace controls", detail: "Lightboxes, sharing, licence products, buyer automation, and API keys.", gated: true }, { key: "insights", title: "Insights", detail: "Contributor demand or buyer ROI from authenticated reporting.", gated: true }, { key: "campaigns", title: "Campaign delivery", detail: "Campaign recommendations and auditable manifest delivery.", gated: true }, ...(canGovern ? [{ key: "governance" as MoreView, title: "Editorial governance", detail: "Correct metadata, review evidence, and approve or reject records." }] : []), { key: "operations", title: "Connected tools", detail: "WordPress pairing, stakeholder reference, and integration boundaries." }, { key: "rights", title: "Rights guide", detail: "Copyright, releases, provenance, and resolution context." }, { key: "status", title: "App status", detail: "API environment and service availability." }];
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}><Text style={styles.eyebrow}>VELD WORKSPACES</Text><Text style={styles.screenTitle}>More</Text><Text style={styles.screenIntro}>The highest-value desktop journeys are now available as native, API-backed mobile surfaces.</Text><View style={styles.stack}>{items.map((item) => <Pressable key={item.key} style={styles.navigationCard} onPress={() => { if (item.gated && !auth.session) { onSignIn(); return; } setView(item.key); }}><View style={styles.navigationIcon}><Layers3 color={COLORS.green} size={20} /></View><View style={styles.navigationCopy}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardMeta}>{item.gated && !auth.session ? "Sign in as a seller or buyer to open this workspace." : item.detail}</Text></View><ChevronRight color={COLORS.muted} size={18} /></Pressable>)}</View></ScrollView>;
}

function StatusScreen({ onBack }: { onBack?: () => void }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { setHealth(await apiGet<HealthResponse>("/api/health")); } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    {onBack ? <Pressable onPress={onBack}><Text style={styles.sectionAction}>← More</Text></Pressable> : null}
    <View style={styles.topRow}><View><Text style={styles.eyebrow}>SYSTEM</Text><Text style={styles.screenTitle}>App status</Text></View><Pressable style={styles.avatarButton} onPress={() => void load()}><RefreshCw color={COLORS.ink} size={20} /></Pressable></View>
    <View style={styles.statusHero}><View style={styles.statusIcon}><Activity color={COLORS.green} size={25} /></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Veld Archive mobile</Text><Text style={styles.cardMeta}>Native Expo client - Metro runtime</Text></View><CheckCircle2 color={COLORS.green} size={22} /></View>
    {loading ? <LoadingState label="Checking services" /> : error ? <ErrorState message="The public API could not be reached" onRetry={load} /> : <View style={styles.statusList}><StatusRow label="API health" value={health?.status ?? (health?.ok ? "healthy" : "available")} /><StatusRow label="Environment" value={health?.environment ?? "unknown"} /><StatusRow label="Endpoint" value={API_BASE_URL.replace(/^https?:\/\//, "")} /><StatusRow label="Operations" value="Admin workspace only" /></View>}
    <View style={styles.offlineNote}><ShieldCheck color={COLORS.blue} size={18} /><Text style={styles.offlineText}>Contributor sessions are stored securely on device and refreshed through Supabase.</Text></View>
  </ScrollView>;
}

function AssetCard({ asset, onPress }: { asset: Asset; onPress: () => void }) {
  return <Pressable style={styles.assetCard} onPress={onPress}><Image source={{ uri: imageFor(asset) }} style={styles.assetImage} /><View style={styles.assetCardBody}><View style={styles.cardLabelRow}><Text style={styles.cardKind}>{asset.kind === "video" ? "VIDEO" : "IMAGE"}</Text>{asset.humanVerified ? <ShieldCheck color={COLORS.green} size={15} /> : null}</View><Text style={styles.cardTitle} numberOfLines={2}>{asset.title}</Text><Text style={styles.cardMeta} numberOfLines={1}>{locationFor(asset)}</Text></View></Pressable>;
}

function SearchResult({ asset, onPress }: { asset: Asset; onPress: () => void }) {
  return <Pressable style={styles.searchResult} onPress={onPress}><Image source={{ uri: imageFor(asset) }} style={styles.resultImage} /><View style={styles.resultCopy}><View style={styles.cardLabelRow}><Text style={styles.cardKind}>{asset.kind === "video" ? "VIDEO" : "IMAGE"}</Text>{asset.humanVerified ? <CheckCircle2 color={COLORS.green} size={15} /> : null}</View><Text style={styles.cardTitle} numberOfLines={2}>{asset.title}</Text><Text style={styles.cardMeta} numberOfLines={1}>{locationFor(asset)}</Text></View><ChevronRight color={COLORS.muted} size={18} /></Pressable>;
}

function BuyerAccessCard({ auth }: { auth: MobileAuth }) {
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const submit = async () => {
    setMessage("");
    try {
      if (mode === "signup") {
        const result = await auth.signUp(email, password, displayName, "buyer");
        setPassword("");
        setMessage(result.confirmationRequired ? "Buyer account created. Confirm the email on this device, then return to this asset." : "Buyer account ready. Continue with licence validation below.");
      } else {
        await auth.signIn(email, password, "buyer");
        setPassword("");
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Buyer access could not be completed.");
    }
  };
  const disabled = auth.loading || !email.trim() || password.length < 8 || mode === "signup" && !displayName.trim();
  return <View style={styles.buyerAccessCard}><Text style={styles.cardKind}>BUYER ACCESS · RETURN TO THIS ASSET</Text><Text style={styles.sectionTitle}>{mode === "signup" ? "Create your buyer account" : "Sign in to continue"}</Text><Text style={styles.cardMeta}>Your selected media stays open. Rights, price, and terms are checked after identity verification.</Text>{mode === "signup" ? <Field label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="How your name should appear" autoCapitalize="words" /> : null}<Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" /><Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" />{(message || auth.error) ? <View style={styles.notice}><ShieldCheck color={COLORS.amber} size={18} /><Text style={styles.noticeText}>{message || auth.error}</Text></View> : null}<Pressable style={[styles.primaryButton, disabled && styles.disabledButton]} disabled={disabled} onPress={() => void submit()}>{auth.loading ? <ActivityIndicator color={COLORS.surface} /> : <><LogIn color={COLORS.surface} size={17} /><Text style={styles.primaryButtonText}>{mode === "signup" ? "Create buyer account" : "Sign in and continue"}</Text></>}</Pressable><Pressable style={styles.secondaryButton} onPress={() => { setMode((current) => current === "signup" ? "signin" : "signup"); setMessage(""); setPassword(""); }}><Text style={styles.secondaryButtonText}>{mode === "signup" ? "I already have an account" : "Create a buyer account"}</Text></Pressable></View>;
}

function AssetDetail({ asset, onClose, auth }: { asset: Asset | null; onClose: () => void; auth: MobileAuth }) {
  const [lightboxes, setLightboxes] = useState<UserLightbox[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [licenceType, setLicenceType] = useState("commercial");
  const [territory, setTerritory] = useState("Worldwide");
  const [durationDays, setDurationDays] = useState(365);
  const [validation, setValidation] = useState<CheckoutValidation | null>(null);
  const [agreements, setAgreements] = useState<MarketplaceAgreementDocument[]>([]);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pendingLicenceId, setPendingLicenceId] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const session = auth.session;
  const loadLightboxes = useCallback(async () => { if (!session) return; const response = await apiRequest<{ results?: UserLightbox[] }>("/api/lightboxes", session); setLightboxes(response.body?.results ?? []); }, [session]);
  useEffect(() => { if (asset && session) void loadLightboxes(); }, [asset, loadLightboxes, session]);

  const loadAgreements = useCallback(async () => {
    try {
      const response = await apiGet<{ documents: MarketplaceAgreementDocument[] }>("/api/legal/agreements");
      setAgreements(response.documents.filter((document) => document.type === "buyer" || document.type === "payment"));
    } catch {
      setAgreements([]); setMessage("The current buyer and payment terms are unavailable. Checkout remains blocked.");
    }
  }, []);

  const validate = useCallback(async () => {
    if (!asset) return;
    setCheckoutBusy(true); setValidation(null); setTermsAccepted(false); setMessage("Checking rights, releases, scope, and price…");
    const response = await apiPost<CheckoutValidation & { error?: string }>("/api/checkout/validate", { assetId: asset.id, licenceType, territory: territory.trim(), durationDays }, session);
    setCheckoutBusy(false);
    if (response.status !== 200 || !response.body) { setMessage(response.body?.error ?? "Licence validation is unavailable. No request or payment was created."); return; }
    setValidation(response.body); setMessage(response.body.allowed ? "Server validation passed. Read and accept both current agreements to continue." : response.body.blockingReasons[0] ?? "This licence is blocked.");
  }, [asset, durationDays, licenceType, session, territory]);

  useEffect(() => { if (checkoutOpen && session) { void validate(); void loadAgreements(); } }, [checkoutOpen, loadAgreements, session, validate]);

  const save = async (lightboxId: string) => { if (!asset || !session) return; const response = await apiRequest<{ error?: string }>(`/api/lightboxes/${encodeURIComponent(lightboxId)}/assets`, session, { method: "POST", body: { assetId: asset.id } }); setMessage(response.status === 201 ? "Saved to your lightbox." : messageFrom(response.body, "The asset could not be saved.")); await loadLightboxes(); };
  const createAndSave = async () => { if (!asset || !session || !newName.trim()) return; const created = await apiRequest<{ id?: string; error?: string }>("/api/lightboxes", session, { method: "POST", body: { name: newName.trim(), visibility: "private" } }); if (created.status !== 201 || !created.body?.id) { setMessage(messageFrom(created.body, "The lightbox could not be created.")); return; } setNewName(""); await save(created.body.id); };

  async function openPayment(licenceId: string) {
    if (!session) return;
    setCheckoutBusy(true); setMessage("Opening Paystack’s hosted checkout…");
    const response = await apiRequest<{ checkoutUrl?: string; error?: string }>(`/api/payments/${encodeURIComponent(licenceId)}/session`, session, { method: "POST", body: { successUrl: `${API_BASE_URL}/buyer?licence=${encodeURIComponent(licenceId)}&payment=complete`, cancelUrl: `${API_BASE_URL}/buyer?licence=${encodeURIComponent(licenceId)}&payment=cancelled` } });
    setCheckoutBusy(false);
    if (response.status !== 201 || !response.body?.checkoutUrl) { setMessage(`Licence request saved. ${response.body?.error ?? "Paystack checkout could not be opened."} Tap Continue payment to retry without creating a duplicate.`); return; }
    await Linking.openURL(response.body.checkoutUrl);
  }

  async function createLicence() {
    if (!asset || !session) return;
    if (pendingLicenceId) { await openPayment(pendingLicenceId); return; }
    const buyerTerms = agreements.find((document) => document.type === "buyer");
    const paymentTerms = agreements.find((document) => document.type === "payment");
    if (!validation?.allowed || !termsAccepted || !buyerTerms || !paymentTerms) { setMessage("Complete validation, read both current agreements, and accept the terms before continuing."); return; }
    setCheckoutBusy(true); setMessage("Saving your licence request and agreement versions…");
    const response = await apiRequest<{ licenceId?: string; error?: string; blockingReasons?: string[] }>("/api/checkout", session, { method: "POST", body: { assetId: asset.id, licenceType, territory: territory.trim(), durationDays, buyerAgreementVersion: buyerTerms.version, paymentAgreementVersion: paymentTerms.version, acceptBuyerTerms: true } });
    setCheckoutBusy(false);
    if (![200, 201].includes(response.status) || !response.body?.licenceId) { setMessage(response.body?.blockingReasons?.[0] ?? response.body?.error ?? "The licence request could not be saved. No payment was created."); return; }
    setPendingLicenceId(response.body.licenceId);
    await openPayment(response.body.licenceId);
  }

  async function openFreeDownload() {
    if (!asset) return;
    if (!session) { setCheckoutOpen(true); return; }
    setCheckoutBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/assets/${encodeURIComponent(asset.id)}/original`, { headers: mobileSessionHeaders(session), redirect: "follow" });
      if (!response.ok) { const body = await response.json().catch(() => null) as { error?: string } | null; setMessage(body?.error ?? "This original is not available for this account."); return; }
      await Linking.openURL(response.url);
    } finally { setCheckoutBusy(false); }
  }

  if (!asset) return null;
  const model = asset.monetizationModel ?? "membership";
  const requestLabel = asset.freeDownloadEnabled ? session ? "Download free photo" : "Create buyer account for free download" : model === "custom_quote" ? "Request custom quote" : "Licence media";
  const licenceTypes = ["editorial", "commercial", "advertising", "social", "broadcast", "exclusive"];
  const buyerTerms = agreements.find((document) => document.type === "buyer");
  const paymentTerms = agreements.find((document) => document.type === "payment");
  return <Modal animationType="slide" transparent visible onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.modalSheet}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Asset detail</Text><Pressable accessibilityLabel="Close asset details" onPress={onClose} style={styles.closeButton}><X color={COLORS.ink} size={20} /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><Image source={{ uri: imageFor(asset) }} style={styles.detailImage} /><Text style={styles.eyebrow}>{asset.kind === "video" ? "VIDEO" : "IMAGE"}</Text><Text style={styles.detailTitle}>{asset.title}</Text><Text style={styles.detailMeta}><MapPin color={COLORS.muted} size={14} /> {locationFor(asset)}</Text>{asset.caption || asset.description ? <Text style={styles.detailDescription}>{asset.caption || asset.description}</Text> : null}<View style={styles.detailFacts}><Fact label="Rights" value={asset.rightsStatus ?? "Pending"} /><Fact label="Model release" value={asset.modelReleaseStatus ?? "Unknown"} /><Fact label="Confidence" value={`${confidenceFor(asset)}%`} /></View>{[...(asset.subjectTags ?? []), ...(asset.culturalTags ?? [])].length ? <View style={styles.tagWrap}>{[...(asset.subjectTags ?? []), ...(asset.culturalTags ?? [])].map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View> : null}<Pressable style={styles.primaryButton} disabled={checkoutBusy} onPress={() => asset.freeDownloadEnabled ? void openFreeDownload() : model === "custom_quote" ? (setCheckoutOpen(true), setMessage("This seller requires a custom quote. No payment or licence request has been created.")) : setCheckoutOpen(true)}><ShieldCheck color={COLORS.surface} size={17} /><Text style={styles.primaryButtonText}>{requestLabel}</Text></Pressable>{checkoutOpen ? <View style={styles.mobileCheckout}><Text style={styles.cardKind}>LICENCE REQUEST</Text><Text style={styles.sectionTitle}>{session ? "Validate before money moves" : "Keep this asset while you sign up"}</Text><Text style={styles.cardMeta}>{session ? "The Worker is authoritative for rights, price, agreements, and payment state. Only a signed Paystack webhook releases the original." : "Create a buyer account here. This asset remains selected when verification completes."}</Text>{!session ? <BuyerAccessCard auth={auth} /> : model === "custom_quote" ? null : <><Text style={styles.fieldLabel}>Licence type</Text><View style={styles.choiceWrap}>{licenceTypes.map((value) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: licenceType === value }} key={value} style={[styles.choiceChip, licenceType === value && styles.choiceChipActive]} onPress={() => { setLicenceType(value); setValidation(null); setTermsAccepted(false); }}><Text style={[styles.choiceChipText, licenceType === value && styles.choiceChipTextActive]}>{value}</Text></Pressable>)}</View><Field label="Territory" value={territory} onChangeText={(value) => { setTerritory(value); setValidation(null); setTermsAccepted(false); }} placeholder="Worldwide or named territory" /><Text style={styles.fieldLabel}>Duration</Text><View style={styles.segmentRow}>{[[30, "30 days"], [90, "90 days"], [365, "1 year"], [730, "2 years"]].map(([value, label]) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: durationDays === value }} key={value} style={[styles.compactSegment, durationDays === value && styles.segmentActive]} onPress={() => { setDurationDays(Number(value)); setValidation(null); setTermsAccepted(false); }}><Text style={[styles.segmentText, durationDays === value && styles.segmentTextActive]}>{label}</Text></Pressable>)}</View><Pressable style={styles.secondaryButton} disabled={checkoutBusy || !territory.trim()} onPress={() => void validate()}>{checkoutBusy && !validation ? <ActivityIndicator color={COLORS.green} /> : <Text style={styles.secondaryButtonText}>{validation ? "Recheck licence" : "Check licence"}</Text>}</Pressable>{validation ? <View style={[styles.validationCard, validation.allowed ? styles.validationClear : styles.validationBlocked]}><View style={styles.validationHeading}><View><Text style={styles.cardKind}>SERVER VALIDATION</Text><Text style={styles.cardTitle}>{validation.allowed ? "Eligible to request" : "Licence blocked"}</Text></View><Text style={styles.validationPrice}>{formatZar(validation.priceCents)}</Text></View>{validation.checks.map((check) => <View style={styles.validationRow} key={check.label}>{check.passed ? <CheckCircle2 color={COLORS.green} size={18} /> : <X color="#9A4834" size={18} />}<View style={{ flex: 1 }}><Text style={styles.cardTitle}>{check.label}</Text><Text style={styles.cardMeta}>{check.detail}</Text></View></View>)}{validation.blockingReasons[0] ? <Text style={styles.blockingText}>{validation.blockingReasons[0]}</Text> : null}</View> : null}{validation?.allowed ? <View style={styles.termsCard}><Pressable style={styles.termsToggle} onPress={() => setTermsOpen((value) => !value)}><View style={{ flex: 1 }}><Text style={styles.cardKind}>CURRENT AGREEMENTS</Text><Text style={styles.cardTitle}>{buyerTerms?.version ?? "Buyer terms unavailable"} · {paymentTerms?.version ?? "Payment terms unavailable"}</Text></View><ChevronRight color={COLORS.muted} size={18} /></Pressable>{termsOpen ? agreements.map((document) => <View key={document.type} style={styles.termsDocument}><Text style={styles.sectionTitle}>{document.title}</Text>{document.sections.map((section) => <View key={section.heading}><Text style={styles.cardTitle}>{section.heading}</Text><Text style={styles.cardMeta}>{section.body}</Text></View>)}</View>) : null}<CheckField checked={termsAccepted} onPress={() => agreements.length === 2 && setTermsAccepted((value) => !value)} label="I have read and accept the selected licence, Buyer Licence Terms, and Paystack Payment Disclosure shown here." /><Pressable style={[styles.primaryButton, (checkoutBusy || !termsAccepted || agreements.length !== 2) && styles.disabledButton]} disabled={checkoutBusy || !termsAccepted || agreements.length !== 2} onPress={() => void createLicence()}>{checkoutBusy ? <ActivityIndicator color={COLORS.surface} /> : <Text style={styles.primaryButtonText}>{pendingLicenceId ? "Continue payment" : "Accept terms & continue to Paystack"}</Text>}</Pressable></View> : null}</>}{message ? <View style={styles.notice}><ShieldCheck color={message.includes("passed") || message.includes("Saved") ? COLORS.green : COLORS.amber} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}</View> : null}<Pressable style={styles.secondaryButton} onPress={() => session ? setSaveOpen((value) => !value) : setCheckoutOpen(true)}><Heart color={COLORS.ink} size={16} /><Text style={styles.secondaryButtonText}>{saveOpen ? "Close lightboxes" : "Save to lightbox"}</Text></Pressable>{saveOpen && session ? <View style={styles.lightboxPanel}><Text style={styles.cardKind}>YOUR LIGHTBOXES</Text>{lightboxes.map((lightbox) => <Pressable key={lightbox.id} style={styles.lightboxRow} disabled={lightbox.assetIds.includes(asset.id)} onPress={() => void save(lightbox.id)}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{lightbox.name}</Text><Text style={styles.cardMeta}>{lightbox.assetCount} assets · {lightbox.visibility}</Text></View><Text style={styles.sectionAction}>{lightbox.assetIds.includes(asset.id) ? "Saved" : "Add"}</Text></Pressable>)}<Field label="New lightbox" value={newName} onChangeText={setNewName} placeholder="Brief, mood, or client" /><Pressable style={styles.secondaryButton} disabled={!newName.trim()} onPress={() => void createAndSave()}><Text style={styles.secondaryButtonText}>Create and save</Text></Pressable></View> : null}{asset.sourceUrl ? <Pressable style={styles.secondaryButton} onPress={() => void Linking.openURL(asset.sourceUrl ?? "")}><ArrowUpRight color={COLORS.ink} size={16} /><Text style={styles.secondaryButtonText}>Open source</Text></Pressable> : null}</ScrollView></View></View></Modal>;
}

function AssetDetailLegacy({ asset, onClose, auth }: { asset: Asset | null; onClose: () => void; auth: MobileAuth }) {
  const [lightboxes, setLightboxes] = useState<UserLightbox[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const session = auth.session;
  const loadLightboxes = useCallback(async () => { if (!session) return; const response = await apiRequest<{ results?: UserLightbox[] }>("/api/lightboxes", session); setLightboxes(response.body?.results ?? []); }, [session]);
  useEffect(() => { if (asset && session) void loadLightboxes(); }, [asset, loadLightboxes, session]);
  const save = async (lightboxId: string) => { if (!asset || !session) return; const response = await apiRequest<{ error?: string }>(`/api/lightboxes/${encodeURIComponent(lightboxId)}/assets`, session, { method: "POST", body: { assetId: asset.id } }); setMessage(response.status === 201 ? "Saved to your lightbox." : messageFrom(response.body, "The asset could not be saved.")); await loadLightboxes(); };
  const createAndSave = async () => { if (!asset || !session || !newName.trim()) return; const created = await apiRequest<{ id?: string; error?: string }>("/api/lightboxes", session, { method: "POST", body: { name: newName.trim(), visibility: "private" } }); if (created.status !== 201 || !created.body?.id) { setMessage(messageFrom(created.body, "The lightbox could not be created.")); return; } setNewName(""); await save(created.body.id); };
  if (!asset) return null;
  return <Modal animationType="slide" transparent visible onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.modalSheet}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Asset detail</Text><Pressable accessibilityLabel="Close asset details" onPress={onClose} style={styles.closeButton}><X color={COLORS.ink} size={20} /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><Image source={{ uri: imageFor(asset) }} style={styles.detailImage} /><Text style={styles.eyebrow}>{asset.kind === "video" ? "VIDEO" : "IMAGE"}</Text><Text style={styles.detailTitle}>{asset.title}</Text><Text style={styles.detailMeta}><MapPin color={COLORS.muted} size={14} /> {locationFor(asset)}</Text>{asset.caption || asset.description ? <Text style={styles.detailDescription}>{asset.caption || asset.description}</Text> : null}<View style={styles.detailFacts}><Fact label="Rights" value={asset.rightsStatus ?? "Pending"} /><Fact label="Verification" value={asset.humanVerified ? "Human verified" : "Editorial review"} /><Fact label="Confidence" value={`${confidenceFor(asset)}%`} /></View>{[...(asset.subjectTags ?? []), ...(asset.culturalTags ?? [])].length ? <View style={styles.tagWrap}>{[...(asset.subjectTags ?? []), ...(asset.culturalTags ?? [])].map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View> : null}{message ? <View style={styles.notice}><CheckCircle2 color={message.includes("Saved") ? COLORS.green : COLORS.amber} size={18} /><Text style={styles.noticeText}>{message}</Text></View> : null}<Pressable style={styles.secondaryButton} onPress={() => session ? setSaveOpen((value) => !value) : Alert.alert("Sign in required", "Sign in to save assets to a private lightbox.")}><Heart color={COLORS.ink} size={16} /><Text style={styles.secondaryButtonText}>{saveOpen ? "Close lightboxes" : "Save to lightbox"}</Text></Pressable>{saveOpen && session ? <View style={styles.lightboxPanel}><Text style={styles.cardKind}>YOUR LIGHTBOXES</Text>{lightboxes.map((lightbox) => <Pressable key={lightbox.id} style={styles.lightboxRow} disabled={lightbox.assetIds.includes(asset.id)} onPress={() => void save(lightbox.id)}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{lightbox.name}</Text><Text style={styles.cardMeta}>{lightbox.assetCount} assets · {lightbox.visibility}</Text></View><Text style={styles.sectionAction}>{lightbox.assetIds.includes(asset.id) ? "Saved" : "Add"}</Text></Pressable>)}<Field label="New lightbox" value={newName} onChangeText={setNewName} placeholder="Brief, mood, or client" /><Pressable style={styles.secondaryButton} disabled={!newName.trim()} onPress={() => void createAndSave()}><Text style={styles.secondaryButtonText}>Create and save</Text></Pressable></View> : null}{asset.sourceUrl ? <Pressable style={styles.secondaryButton} onPress={() => void Linking.openURL(asset.sourceUrl ?? "")}><ArrowUpRight color={COLORS.ink} size={16} /><Text style={styles.secondaryButtonText}>Open source</Text></Pressable> : null}</ScrollView></View></View></Modal>;
}

function Field({ label, value, onChangeText, placeholder, multiline = false, ...inputProps }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; secureTextEntry?: boolean; editable?: boolean; maxLength?: number; autoCapitalize?: "none" | "sentences" | "words" | "characters"; keyboardType?: "default" | "email-address" | "url" | "phone-pad" | "number-pad" }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={COLORS.muted} multiline={multiline} {...inputProps} style={[styles.textField, multiline && styles.multilineField]} /></View>; }
function Fact({ label, value }: { label: string; value: string }) { return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue} numberOfLines={1}>{value}</Text></View>; }
function StatusRow({ label, value }: { label: string; value: string }) { return <View style={styles.statusRow}><View style={styles.statusDot} /><Text style={styles.statusLabel}>{label}</Text><Text style={styles.statusValue} numberOfLines={1}>{value}</Text></View>; }
function SectionHeader({ title, action, onPress }: { title: string; action: string; onPress: () => void }) { return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Pressable onPress={onPress}><Text style={styles.sectionAction}>{action}</Text></Pressable></View>; }
function LoadingState({ label }: { label: string }) { return <View style={styles.centerState}><ActivityIndicator color={COLORS.green} /><Text style={styles.stateText}>{label}</Text></View>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.centerState}><WifiOff color={COLORS.amber} size={28} /><Text style={styles.stateText}>{message}</Text><Pressable onPress={onRetry}><Text style={styles.sectionAction}>Try again</Text></Pressable></View>; }
function EmptyState({ label = "No published assets yet" }: { label?: string }) { return <View style={styles.centerState}><ImageIcon color={COLORS.muted} size={28} /><Text style={styles.stateText}>{label}</Text></View>; }

export default function App() {
  const auth = useMobileAuth(API_BASE_URL);
  const [tab, setTab] = useState<TabKey>("explore");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [moreInitialView, setMoreInitialView] = useState<"menu" | "account">("menu");
  const [createAuthMode, setCreateAuthMode] = useState<"signin" | "signup">("signup");
  const changeTab = (nextTab: TabKey) => { void Haptics.selectionAsync(); setTab(nextTab); };
  const openSearch = (query: string) => { setSearchQuery(query); changeTab("search"); };
  const openAccount = () => { setMoreInitialView("account"); changeTab("more"); };
  const openCreate = (mode: "signin" | "signup") => { setCreateAuthMode(mode); changeTab("create"); };
  const tabs = tabsForRole(auth.session?.user.role);
  return <SafeAreaView style={styles.app}><StatusBar style="dark" /><View style={styles.content}>{tab === "explore" ? <ExploreScreen onOpenAsset={setSelectedAsset} onSearch={openSearch} onAccount={openAccount} /> : tab === "search" ? <SearchScreen initialQuery={searchQuery} onOpenAsset={setSelectedAsset} auth={auth} /> : tab === "create" ? <CreateScreen auth={auth} initialAuthMode={createAuthMode} /> : <MoreScreen initialView={moreInitialView} auth={auth} onOpenAsset={setSelectedAsset} onSell={() => openCreate("signup")} onSignIn={() => { setMoreInitialView("menu"); openCreate("signin"); }} />}</View><View style={styles.tabBar}>{tabs.map(({ key, label, icon: TabIcon }) => { const active = tab === key; return <Pressable key={key} style={styles.tabItem} onPress={() => { if (key === "more") setMoreInitialView("menu"); if (key === "create") setCreateAuthMode("signup"); changeTab(key); }} accessibilityRole="tab" accessibilityState={{ selected: active }}><TabIcon color={active ? COLORS.green : COLORS.muted} size={21} strokeWidth={active ? 2.4 : 1.8} /><Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text></Pressable>; })}</View><AssetDetail asset={selectedAsset} onClose={() => setSelectedAsset(null)} auth={auth} /></SafeAreaView>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: COLORS.paper },
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 34 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  eyebrow: { color: COLORS.green, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 6 },
  screenTitle: { color: COLORS.ink, fontSize: 30, fontWeight: "800", letterSpacing: 0 },
  screenIntro: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 15 },
  avatarButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.line },
  searchBar: { height: 56, backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 7, gap: 10, marginBottom: 18 },
  searchPlaceholder: { flex: 1, color: COLORS.muted, fontSize: 14 },
  searchAction: { width: 42, height: 42, borderRadius: 13, backgroundColor: COLORS.green, alignItems: "center", justifyContent: "center" },
  heroBand: { backgroundColor: COLORS.greenSoft, minHeight: 176, borderRadius: 22, padding: 20, flexDirection: "row", overflow: "hidden", marginBottom: 25 },
  heroCopy: { flex: 1, paddingRight: 9 },
  heroKicker: { color: COLORS.green, fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 8 },
  heroTitle: { color: COLORS.ink, fontSize: 25, fontWeight: "800", lineHeight: 30 },
  heroText: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 7, maxWidth: 235 },
  heroButton: { alignSelf: "flex-start", backgroundColor: COLORS.green, borderRadius: 12, paddingHorizontal: 13, height: 38, flexDirection: "row", alignItems: "center", gap: 3, marginTop: 14 },
  heroButtonText: { color: COLORS.surface, fontWeight: "700", fontSize: 12 },
  heroMark: { width: 78, alignItems: "center", justifyContent: "center", opacity: 0.8 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { color: COLORS.ink, fontSize: 18, fontWeight: "800" },
  sectionAction: { color: COLORS.green, fontSize: 14, fontWeight: "800", minHeight: 46, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: COLORS.green, borderRadius: 13, backgroundColor: COLORS.greenSoft, marginBottom: 12 },
  chipRow: { gap: 9, paddingBottom: 24 },
  trendChip: { height: 36, borderRadius: 18, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 6 },
  trendText: { color: COLORS.ink, fontSize: 12, fontWeight: "700" },
  assetGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 25 },
  assetCard: { width: "48.2%", backgroundColor: COLORS.surface, borderRadius: 15, borderWidth: 1, borderColor: COLORS.line, overflow: "hidden", marginBottom: 12 },
  assetImage: { width: "100%", height: 132, backgroundColor: COLORS.blueSoft },
  assetCardBody: { padding: 11 },
  cardLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 7 },
  cardKind: { color: COLORS.green, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  cardTitle: { color: COLORS.ink, fontSize: 14, fontWeight: "800", lineHeight: 19, marginTop: 5 },
  cardMeta: { color: COLORS.muted, fontSize: 11, marginTop: 5 },
  recommendationList: { gap: 9, marginBottom: 20 },
  recommendation: { minHeight: 70, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line, padding: 9, flexDirection: "row", alignItems: "center", gap: 11 },
  recommendationImage: { width: 53, height: 53, borderRadius: 10, backgroundColor: COLORS.blueSoft },
  recommendationCopy: { flex: 1 },
  searchInputWrap: { minHeight: 54, backgroundColor: COLORS.surface, borderRadius: 15, borderWidth: 1, borderColor: COLORS.line, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 15, marginTop: 17 },
  searchInput: { flex: 1, color: COLORS.ink, fontSize: 15, minHeight: 52 },
  segmentRow: { flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 12 },
  segment: { flex: 1, height: 40, borderRadius: 11, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  compactSegment: { minHeight: 40, flexGrow: 1, borderRadius: 11, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segmentActive: { backgroundColor: COLORS.ink, borderColor: COLORS.ink },
  segmentText: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  segmentTextActive: { color: COLORS.surface },
  sortRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16 },
  sortText: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  sortTextActive: { color: COLORS.ink },
  filterButton: { marginLeft: "auto", borderWidth: 1, borderColor: COLORS.line, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  filterText: { color: COLORS.ink, fontSize: 11, fontWeight: "800" },
  primaryButton: { minHeight: 48, backgroundColor: COLORS.green, borderRadius: 13, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingHorizontal: 16, marginBottom: 20 },
  primaryButtonText: { color: COLORS.surface, fontSize: 14, fontWeight: "800" },
  disabledButton: { opacity: 0.65 },
  searchResults: { gap: 10 },
  searchResult: { minHeight: 86, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line, padding: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  resultImage: { width: 70, height: 66, borderRadius: 10, backgroundColor: COLORS.blueSoft },
  resultCopy: { flex: 1 },
  searchPrompt: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 12 },
  searchPromptTitle: { color: COLORS.ink, fontSize: 16, fontWeight: "700", textAlign: "center" },
  uploadDropzone: { minHeight: 132, borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.green, borderStyle: "dashed", alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: COLORS.greenSoft, marginBottom: 21 },
  dropzoneTitle: { color: COLORS.ink, fontSize: 15, fontWeight: "800", marginTop: 8 },
  dropzoneMeta: { color: COLORS.muted, fontSize: 11, marginTop: 5, textAlign: "center" },
  field: { marginBottom: 15 },
  fieldLabel: { color: COLORS.ink, fontSize: 12, fontWeight: "800", marginBottom: 7 },
  fieldHint: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: -9, marginBottom: 15 },
  textField: { minHeight: 48, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, backgroundColor: COLORS.surface, paddingHorizontal: 14, color: COLORS.ink, fontSize: 14 },
  multilineField: { minHeight: 92, paddingTop: 13, textAlignVertical: "top" },
  notice: { backgroundColor: COLORS.amberSoft, borderRadius: 12, padding: 12, flexDirection: "row", gap: 8, alignItems: "flex-start", marginBottom: 15 },
  noticeText: { color: COLORS.ink, flex: 1, fontSize: 12, lineHeight: 18 },
  accountCard: { minHeight: 64, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line, padding: 13, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 17 },
  workspaceToggle: { flexDirection: "row", backgroundColor: COLORS.line, borderRadius: 13, padding: 3, marginBottom: 18 },
  workspaceToggleButton: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  workspaceToggleActive: { backgroundColor: COLORS.ink },
  workspaceToggleText: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
  progressCard: { backgroundColor: COLORS.greenSoft, borderRadius: 15, padding: 15, marginBottom: 12 },
  stepRow: { flexDirection: "row", gap: 7, marginBottom: 15 },
  stepButton: { flex: 1, minHeight: 54, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center", gap: 3 },
  stepButtonActive: { backgroundColor: COLORS.ink, borderColor: COLORS.ink },
  stepNumber: { color: COLORS.green, fontSize: 10, fontWeight: "900" },
  stepText: { color: COLORS.muted, fontSize: 11, fontWeight: "800" },
  stepTextActive: { color: COLORS.surface },
  formCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 15, marginBottom: 20 },
  checkRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  checkBox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  checkBoxActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  checkLabel: { flex: 1, color: COLORS.ink, fontSize: 12, lineHeight: 18 },
  inlineNote: { backgroundColor: COLORS.blueSoft, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 12 },
  inlineNoteText: { flex: 1, color: COLORS.blue, fontSize: 11, lineHeight: 17 },
  turnstileFrame: { height: 100, overflow: "hidden", borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, marginBottom: 12 },
  twoColumn: { flexDirection: "row", gap: 10 },
  column: { flex: 1 },
  stack: { gap: 10, marginBottom: 20 },
  listCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, padding: 14 },
  featureCard: { backgroundColor: COLORS.greenSoft, borderRadius: 14, padding: 14 },
  navigationCard: { minHeight: 82, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 15, padding: 12, flexDirection: "row", alignItems: "center", gap: 11 },
  navigationIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: COLORS.greenSoft, alignItems: "center", justifyContent: "center" },
  navigationCopy: { flex: 1 },
  creatorAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.ink, alignItems: "center", justifyContent: "center" },
  creatorAvatarText: { color: COLORS.surface, fontSize: 18, fontWeight: "900" },
  bodyText: { color: COLORS.ink, fontSize: 14, lineHeight: 21, marginBottom: 15 },
  statGrid: { flexDirection: "row", gap: 8, marginBottom: 16 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 20 },
  metricCard: { width: "48.5%", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, padding: 14, marginBottom: 10 },
  metricValue: { color: COLORS.ink, fontSize: 23, fontWeight: "900", marginTop: 8 },
  dangerButton: { minHeight: 46, borderWidth: 1, borderColor: "#B6614C", borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  dangerButtonText: { color: "#8A3D2B", fontSize: 13, fontWeight: "800" },
  libraryRow: { gap: 10, paddingBottom: 16 },
  libraryItem: { width: 150, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, padding: 9 },
  libraryItemActive: { borderColor: COLORS.green, borderWidth: 2 },
  libraryThumb: { width: "100%", height: 90, borderRadius: 10, backgroundColor: COLORS.blueSoft },
  lightboxPanel: { backgroundColor: COLORS.greenSoft, borderRadius: 14, padding: 13, marginBottom: 12 },
  lightboxRow: { minHeight: 58, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: COLORS.line },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  smallAction: { minHeight: 38, borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.paper },
  smallActionText: { color: COLORS.ink, fontSize: 10, fontWeight: "800", textTransform: "capitalize" },
  statusHero: { backgroundColor: COLORS.greenSoft, borderRadius: 16, padding: 15, flexDirection: "row", alignItems: "center", gap: 11, marginTop: 19, marginBottom: 15 },
  statusIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  statusList: { backgroundColor: COLORS.surface, borderRadius: 15, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 15, marginBottom: 15 },
  statusRow: { minHeight: 53, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.green },
  statusLabel: { color: COLORS.muted, fontSize: 12, flex: 1 },
  statusValue: { color: COLORS.ink, fontSize: 12, fontWeight: "800", maxWidth: 190 },
  offlineNote: { borderRadius: 13, backgroundColor: COLORS.blueSoft, padding: 13, flexDirection: "row", gap: 9, alignItems: "center" },
  offlineText: { color: COLORS.blue, fontSize: 11, lineHeight: 17, flex: 1 },
  centerState: { minHeight: 150, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 30 },
  stateText: { color: COLORS.muted, textAlign: "center", fontSize: 13 },
  tabBar: { height: 76, borderTopWidth: 1, borderTopColor: COLORS.line, backgroundColor: COLORS.surface, flexDirection: "row", paddingHorizontal: 8, paddingTop: 10 },
  tabItem: { flex: 1, alignItems: "center", gap: 5 },
  tabLabel: { color: COLORS.muted, fontSize: 10, fontWeight: "700" },
  tabLabelActive: { color: COLORS.green },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(23,32,29,0.45)", justifyContent: "flex-end" },
  modalSheet: { maxHeight: "91%", backgroundColor: COLORS.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { color: COLORS.ink, fontSize: 18, fontWeight: "800" },
  closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  detailImage: { width: "100%", height: 230, borderRadius: 16, backgroundColor: COLORS.blueSoft, marginBottom: 17 },
  detailTitle: { color: COLORS.ink, fontSize: 24, lineHeight: 29, fontWeight: "800", marginBottom: 8 },
  detailMeta: { color: COLORS.muted, fontSize: 12, marginBottom: 14 },
  detailDescription: { color: COLORS.ink, fontSize: 14, lineHeight: 21, marginBottom: 17 },
  detailFacts: { flexDirection: "row", gap: 8, marginBottom: 16 },
  fact: { flex: 1, minHeight: 60, backgroundColor: COLORS.surface, borderRadius: 11, padding: 10 },
  factLabel: { color: COLORS.muted, fontSize: 10, marginBottom: 5 },
  factValue: { color: COLORS.ink, fontSize: 11, fontWeight: "800" },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 18 },
  tag: { color: COLORS.green, backgroundColor: COLORS.greenSoft, borderRadius: 15, paddingHorizontal: 10, paddingVertical: 7, fontSize: 11, fontWeight: "700" },
  secondaryButton: { minHeight: 46, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, backgroundColor: COLORS.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 10 },
  secondaryButtonText: { color: COLORS.ink, fontSize: 13, fontWeight: "800" },
  buyerAccessCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 15, marginTop: 14, marginBottom: 14 },
  mobileCheckout: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 15, marginBottom: 14 },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 16 },
  choiceChip: { minHeight: 38, borderWidth: 1, borderColor: COLORS.line, borderRadius: 19, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.paper },
  choiceChipActive: { borderColor: COLORS.ink, backgroundColor: COLORS.ink },
  choiceChipText: { color: COLORS.ink, fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  choiceChipTextActive: { color: COLORS.surface },
  validationCard: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, padding: 13, marginBottom: 13 },
  validationClear: { borderColor: "#9DB89F", backgroundColor: COLORS.greenSoft },
  validationBlocked: { borderColor: "#D5A18F", backgroundColor: "#FFF0EA" },
  validationHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  validationPrice: { color: COLORS.green, fontSize: 15, fontWeight: "900" },
  validationRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderTopWidth: 1, borderTopColor: COLORS.line, paddingVertical: 10 },
  blockingText: { color: "#8A3D2B", fontSize: 12, lineHeight: 18, fontWeight: "800" },
  termsCard: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, padding: 13, marginBottom: 13, backgroundColor: COLORS.paper },
  termsToggle: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10 },
  termsDocument: { gap: 12, borderTopWidth: 1, borderTopColor: COLORS.line, paddingTop: 13, marginTop: 8, marginBottom: 13 },
  mobileFlowSteps: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 15 },
  mobileFlowStep: { minWidth: "30%", flexGrow: 1, minHeight: 58, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, padding: 10, justifyContent: "center", gap: 3 },
});
