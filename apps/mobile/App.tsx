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
  MapPin,
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

declare const process: { env: { EXPO_PUBLIC_API_BASE_URL?: string } };

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

type HealthResponse = { ok?: boolean; status?: string; service?: string; version?: string };

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

const tabs: Array<{ key: TabKey; label: string; icon: Icon }> = [
  { key: "explore", label: "Explore", icon: Home },
  { key: "search", label: "Search", icon: Search },
  { key: "create", label: "Create", icon: FilePlus2 },
  { key: "status", label: "Status", icon: Activity },
];

type TabKey = "explore" | "search" | "create" | "status";

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

async function apiPost<T>(path: string, payload: unknown): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null) as T | null;
  return { status: response.status, body };
}

function locationFor(asset: Asset) {
  return [asset.locality, asset.city, asset.province].filter(Boolean).join(", ") || "Location pending";
}

function imageFor(asset: Asset) {
  return asset.previewUrl || `${API_BASE_URL}/api/assets/${encodeURIComponent(asset.id)}/image/card`;
}

function confidenceFor(asset: Asset) {
  const value = Number(asset.authenticityConfidence ?? 0);
  return value > 1 ? Math.round(value) : Math.round(value * 100);
}

function ExploreScreen({ onOpenAsset, onSearch }: { onOpenAsset: (asset: Asset) => void; onSearch: (query: string) => void }) {
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
        <Pressable style={styles.avatarButton} onPress={() => void Haptics.selectionAsync()} accessibilityLabel="Account">
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

function SearchScreen({ initialQuery, onOpenAsset }: { initialQuery: string; onOpenAsset: (asset: Asset) => void }) {
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState("relevance");
  const [results, setResults] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (nextQuery = query) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<SearchResponse>(`/api/assets?${queryString({ q: nextQuery.trim(), kind, status: "published", sort })}`);
      setResults(response.results);
      setHasSearched(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [kind, query, sort]);

  useEffect(() => { if (initialQuery) void search(initialQuery); }, [initialQuery, search]);

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
      {loading ? <LoadingState label="Searching" /> : error ? <ErrorState message={error} onRetry={() => search()} /> : hasSearched ? (
        results.length ? <View style={styles.searchResults}>{results.map((asset) => <SearchResult key={asset.id} asset={asset} onPress={() => onOpenAsset(asset)} />)}</View> : <EmptyState label="No published assets matched" />
      ) : <View style={styles.searchPrompt}><Compass color={COLORS.green} size={32} /><Text style={styles.searchPromptTitle}>Start with a place, feeling, or subject.</Text></View>}
    </ScrollView>
  );
}

function CreateScreen() {
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [city, setCity] = useState("");
  const [tags, setTags] = useState("");
  const [kind, setKind] = useState<"image" | "video">("image");
  const [rights, setRights] = useState("verified");
  const [selectedMedia, setSelectedMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    if (!title.trim()) { setMessage("A title is required."); return; }
    if (!selectedMedia) { setMessage("Choose an image before submitting."); return; }
    setSaving(true);
    setMessage(null);
    const response = await apiPost<{ id?: string; error?: string }>("/api/assets", {
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
      monetizationModel: "free_editorial",
      artistLicenseKey: "cc_by_4_0",
      artistLicenseVersion: "4.0",
      artistLicenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    });
    setSaving(false);
    if (response.status === 201 && response.body && "id" in response.body) {
      const mediaType = selectedMedia.mimeType ?? "image/jpeg";
      const fileResponse = await fetch(selectedMedia.uri);
      const mediaBlob = await fileResponse.blob();
      const upload = await apiPost<{ uploadId?: string; uploadUrl?: string; error?: string }>("/api/uploads", {
        filename: selectedMedia.fileName ?? `veld-${Date.now()}.jpg`,
        contentType: mediaType,
        sizeBytes: selectedMedia.fileSize ?? mediaBlob.size,
        assetId: response.body.id,
      });
      if (upload.status !== 201 || !upload.body?.uploadId || !upload.body.uploadUrl) {
        setMessage(upload.body?.error ?? "The media upload session could not be created.");
        setSaving(false);
        return;
      }
      const putResponse = await fetch(upload.body.uploadUrl, { method: "PUT", headers: { "Content-Type": mediaType }, body: mediaBlob });
      if (!putResponse.ok) { setMessage("The media upload failed before completion."); setSaving(false); return; }
      const completion = await apiPost<{ error?: string }>(`/api/uploads/${upload.body.uploadId}/complete`, {});
      if (completion.status >= 300) { setMessage(completion.body?.error ?? "The media upload could not be completed."); setSaving(false); return; }
      setMessage("Draft submitted for editorial review.");
      setTitle(""); setCaption(""); setCity(""); setTags(""); setSelectedMedia(null);
    } else if (response.status === 401 || response.status === 403) {
      setMessage("Sign in with a contributor account to submit assets.");
    } else {
      setMessage(response.body?.error ?? "The draft could not be submitted.");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>CONTRIBUTE</Text>
      <Text style={styles.screenTitle}>Add to the archive</Text>
      <Text style={styles.screenIntro}>Prepare metadata for editorial review.</Text>
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
    </ScrollView>
  );
}

function StatusScreen() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [readiness, setReadiness] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { const [nextHealth, nextReadiness] = await Promise.all([apiGet<HealthResponse>("/api/health"), apiGet<HealthResponse>("/api/ops/readiness")]); setHealth(nextHealth); setReadiness(nextReadiness); } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <View style={styles.topRow}><View><Text style={styles.eyebrow}>SYSTEM</Text><Text style={styles.screenTitle}>App status</Text></View><Pressable style={styles.avatarButton} onPress={() => void load()}><RefreshCw color={COLORS.ink} size={20} /></Pressable></View>
    <View style={styles.statusHero}><View style={styles.statusIcon}><Activity color={COLORS.green} size={25} /></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Veld Archive mobile</Text><Text style={styles.cardMeta}>Native Expo client - Metro runtime</Text></View><CheckCircle2 color={COLORS.green} size={22} /></View>
    {loading ? <LoadingState label="Checking services" /> : error ? <ErrorState message="The API could not be reached" onRetry={load} /> : <View style={styles.statusList}><StatusRow label="API health" value={health?.status ?? (health?.ok ? "healthy" : "available")} /><StatusRow label="Readiness" value={readiness?.status ?? "ready"} /><StatusRow label="Endpoint" value={API_BASE_URL.replace(/^https?:\/\//, "")} /><StatusRow label="Media review" value="Editorial gates active" /></View>}
    <View style={styles.offlineNote}><WifiOff color={COLORS.blue} size={18} /><Text style={styles.offlineText}>Offline caching will be added alongside authenticated sync.</Text></View>
  </ScrollView>;
}

function AssetCard({ asset, onPress }: { asset: Asset; onPress: () => void }) {
  return <Pressable style={styles.assetCard} onPress={onPress}><Image source={{ uri: imageFor(asset) }} style={styles.assetImage} /><View style={styles.assetCardBody}><View style={styles.cardLabelRow}><Text style={styles.cardKind}>{asset.kind === "video" ? "VIDEO" : "IMAGE"}</Text>{asset.humanVerified ? <ShieldCheck color={COLORS.green} size={15} /> : null}</View><Text style={styles.cardTitle} numberOfLines={2}>{asset.title}</Text><Text style={styles.cardMeta} numberOfLines={1}>{locationFor(asset)}</Text></View></Pressable>;
}

function SearchResult({ asset, onPress }: { asset: Asset; onPress: () => void }) {
  return <Pressable style={styles.searchResult} onPress={onPress}><Image source={{ uri: imageFor(asset) }} style={styles.resultImage} /><View style={styles.resultCopy}><View style={styles.cardLabelRow}><Text style={styles.cardKind}>{asset.kind === "video" ? "VIDEO" : "IMAGE"}</Text>{asset.humanVerified ? <CheckCircle2 color={COLORS.green} size={15} /> : null}</View><Text style={styles.cardTitle} numberOfLines={2}>{asset.title}</Text><Text style={styles.cardMeta} numberOfLines={1}>{locationFor(asset)}</Text></View><ChevronRight color={COLORS.muted} size={18} /></Pressable>;
}

function AssetDetail({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  if (!asset) return null;
  return <Modal animationType="slide" transparent visible onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.modalSheet}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Asset detail</Text><Pressable onPress={onClose} style={styles.closeButton}><X color={COLORS.ink} size={20} /></Pressable></View><ScrollView showsVerticalScrollIndicator={false}><Image source={{ uri: imageFor(asset) }} style={styles.detailImage} /><Text style={styles.eyebrow}>{asset.kind === "video" ? "VIDEO" : "IMAGE"}</Text><Text style={styles.detailTitle}>{asset.title}</Text><Text style={styles.detailMeta}><MapPin color={COLORS.muted} size={14} /> {locationFor(asset)}</Text>{asset.caption || asset.description ? <Text style={styles.detailDescription}>{asset.caption || asset.description}</Text> : null}<View style={styles.detailFacts}><Fact label="Rights" value={asset.rightsStatus ?? "Pending"} /><Fact label="Verification" value={asset.humanVerified ? "Human verified" : "Editorial review"} /><Fact label="Confidence" value={`${confidenceFor(asset)}%`} /></View>{[...(asset.subjectTags ?? []), ...(asset.culturalTags ?? [])].length ? <View style={styles.tagWrap}>{[...(asset.subjectTags ?? []), ...(asset.culturalTags ?? [])].map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View> : null}{asset.sourceUrl ? <Pressable style={styles.secondaryButton} onPress={() => void Linking.openURL(asset.sourceUrl ?? "")}><ArrowUpRight color={COLORS.ink} size={16} /><Text style={styles.secondaryButtonText}>Open source</Text></Pressable> : null}</ScrollView></View></View></Modal>;
}

function Field({ label, value, onChangeText, placeholder, multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={COLORS.muted} multiline={multiline} style={[styles.textField, multiline && styles.multilineField]} /></View>; }
function Fact({ label, value }: { label: string; value: string }) { return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue} numberOfLines={1}>{value}</Text></View>; }
function StatusRow({ label, value }: { label: string; value: string }) { return <View style={styles.statusRow}><View style={styles.statusDot} /><Text style={styles.statusLabel}>{label}</Text><Text style={styles.statusValue} numberOfLines={1}>{value}</Text></View>; }
function SectionHeader({ title, action, onPress }: { title: string; action: string; onPress: () => void }) { return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Pressable onPress={onPress}><Text style={styles.sectionAction}>{action}</Text></Pressable></View>; }
function LoadingState({ label }: { label: string }) { return <View style={styles.centerState}><ActivityIndicator color={COLORS.green} /><Text style={styles.stateText}>{label}</Text></View>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.centerState}><WifiOff color={COLORS.amber} size={28} /><Text style={styles.stateText}>{message}</Text><Pressable onPress={onRetry}><Text style={styles.sectionAction}>Try again</Text></Pressable></View>; }
function EmptyState({ label = "No published assets yet" }: { label?: string }) { return <View style={styles.centerState}><ImageIcon color={COLORS.muted} size={28} /><Text style={styles.stateText}>{label}</Text></View>; }

export default function App() {
  const [tab, setTab] = useState<TabKey>("explore");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const changeTab = (nextTab: TabKey) => { void Haptics.selectionAsync(); setTab(nextTab); };
  const openSearch = (query: string) => { setSearchQuery(query); changeTab("search"); };
  return <SafeAreaView style={styles.app}><StatusBar style="dark" /><View style={styles.content}>{tab === "explore" ? <ExploreScreen onOpenAsset={setSelectedAsset} onSearch={openSearch} /> : tab === "search" ? <SearchScreen initialQuery={searchQuery} onOpenAsset={setSelectedAsset} /> : tab === "create" ? <CreateScreen /> : <StatusScreen />}</View><View style={styles.tabBar}>{tabs.map(({ key, label, icon: TabIcon }) => { const active = tab === key; return <Pressable key={key} style={styles.tabItem} onPress={() => changeTab(key)} accessibilityRole="tab" accessibilityState={{ selected: active }}><TabIcon color={active ? COLORS.green : COLORS.muted} size={21} strokeWidth={active ? 2.4 : 1.8} /><Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text></Pressable>; })}</View><AssetDetail asset={selectedAsset} onClose={() => setSelectedAsset(null)} /></SafeAreaView>;
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
  sectionAction: { color: COLORS.green, fontSize: 12, fontWeight: "800" },
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
  textField: { minHeight: 48, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, backgroundColor: COLORS.surface, paddingHorizontal: 14, color: COLORS.ink, fontSize: 14 },
  multilineField: { minHeight: 92, paddingTop: 13, textAlignVertical: "top" },
  notice: { backgroundColor: COLORS.amberSoft, borderRadius: 12, padding: 12, flexDirection: "row", gap: 8, alignItems: "flex-start", marginBottom: 15 },
  noticeText: { color: COLORS.ink, flex: 1, fontSize: 12, lineHeight: 18 },
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
});
