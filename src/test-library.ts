import type { Asset, PhotoCategory, VisualLocationType } from "./shared";

type TestTheme = {
  title: string;
  description: string;
  caption: string;
  province: string;
  city: string;
  locality: string;
  landmark: string | null;
  subjectTags: string[];
  culturalTags: string[];
  visualLocationType: VisualLocationType;
  primaryCategory: PhotoCategory;
};

const themes: TestTheme[] = [
  { title: "Street cat in Cape Town", description: "Synthetic search fixture describing a neighbourhood cat in Cape Town.", caption: "A neighbourhood cat rests in a Cape Town street setting.", province: "Western Cape", city: "Cape Town", locality: "Bo-Kaap", landmark: null, subjectTags: ["cat", "animal", "street", "pet"], culturalTags: ["Cape Town", "urban wildlife"], visualLocationType: "urban_street", primaryCategory: "nature" },
  { title: "Drakensberg mountain light", description: "Synthetic search fixture describing a mountain landscape in KwaZulu-Natal.", caption: "Mountain ridges catch early light in the Drakensberg.", province: "KwaZulu-Natal", city: "Bergville", locality: "Drakensberg", landmark: "Drakensberg Mountains", subjectTags: ["mountain", "landscape", "hiking", "nature"], culturalTags: ["KwaZulu-Natal", "South African landscape"], visualLocationType: "rural_landscape", primaryCategory: "nature" },
  { title: "Indian Ocean shoreline", description: "Synthetic search fixture describing a coastal landscape near Durban.", caption: "An Indian Ocean shoreline near Durban, South Africa.", province: "KwaZulu-Natal", city: "Durban", locality: "Umhlanga", landmark: "Indian Ocean", subjectTags: ["ocean", "coast", "beach", "landscape"], culturalTags: ["Durban", "KwaZulu-Natal coast"], visualLocationType: "coastal_landscape", primaryCategory: "travel" },
  { title: "Soweto market morning", description: "Synthetic search fixture describing a food market in Johannesburg.", caption: "A busy market morning in Soweto, Johannesburg.", province: "Gauteng", city: "Johannesburg", locality: "Soweto", landmark: null, subjectTags: ["market", "food", "street", "community"], culturalTags: ["Soweto", "Johannesburg", "South African everyday life"], visualLocationType: "market_scene", primaryCategory: "food" },
  { title: "Garden Route road", description: "Synthetic search fixture describing a road journey through the Garden Route.", caption: "A road through the Garden Route landscape.", province: "Western Cape", city: "George", locality: "Garden Route", landmark: "Outeniqua Mountains", subjectTags: ["road", "travel", "driving", "landscape"], culturalTags: ["Garden Route", "South African road life"], visualLocationType: "transport", primaryCategory: "travel" },
  { title: "Johannesburg brick facade", description: "Synthetic search fixture describing an urban architecture detail in Johannesburg.", caption: "A brick facade and geometric shadows in Johannesburg.", province: "Gauteng", city: "Johannesburg", locality: "Maboneng", landmark: null, subjectTags: ["architecture", "building", "urban", "facade"], culturalTags: ["Johannesburg", "urban South Africa"], visualLocationType: "urban_street", primaryCategory: "architecture" },
  { title: "Cape Flats braai table", description: "Synthetic search fixture describing a communal food scene in Cape Town.", caption: "A shared braai table in the Cape Flats.", province: "Western Cape", city: "Cape Town", locality: "Mitchells Plain", landmark: null, subjectTags: ["food", "braai", "community", "outdoor"], culturalTags: ["South African braai", "Cape Flats", "Cape Town"], visualLocationType: "food", primaryCategory: "food" },
  { title: "Kruger savanna grassland", description: "Synthetic search fixture describing wildlife habitat in Mpumalanga.", caption: "Open savanna and acacia trees near Kruger National Park.", province: "Mpumalanga", city: "Skukuza", locality: "Kruger National Park", landmark: "Kruger National Park", subjectTags: ["wildlife", "savanna", "trees", "landscape"], culturalTags: ["Mpumalanga", "South African nature"], visualLocationType: "nature", primaryCategory: "nature" },
  { title: "Mamelodi football field", description: "Synthetic search fixture describing a community sport field in Tshwane.", caption: "A local football field in Mamelodi, Tshwane.", province: "Gauteng", city: "Pretoria", locality: "Mamelodi", landmark: null, subjectTags: ["football", "sport", "community", "field"], culturalTags: ["Mamelodi", "Tshwane", "South African sport"], visualLocationType: "sports", primaryCategory: "sport" },
  { title: "Craft studio still life", description: "Synthetic search fixture describing handmade objects in a Cape Town studio.", caption: "Handmade craft objects arranged in a Cape Town studio.", province: "Western Cape", city: "Cape Town", locality: "Woodstock", landmark: null, subjectTags: ["craft", "objects", "studio", "design"], culturalTags: ["Cape Town", "South African design"], visualLocationType: "indoor", primaryCategory: "arts_culture" },
];

/**
 * Development-only records used when the Worker is unavailable. These records
 * intentionally have no media preview: the local D1 search seed is synthetic,
 * and reusing an unrelated demo photograph would make its visual evidence
 * contradict the searchable metadata.
 */
export const testPhotoLibrary: Asset[] = Array.from({ length: 100 }, (_, index) => {
  const theme = themes[index % themes.length];
  const sequence = String(index + 1).padStart(3, "0");
  return {
    id: `asset-test-photo-${sequence}`,
    kind: "image",
    status: "published",
    title: `${theme.title} ${sequence}`,
    description: theme.description,
    caption: theme.caption,
    country: "South Africa",
    province: theme.province,
    city: theme.city,
    locality: theme.locality,
    landmark: theme.landmark,
    subjectTags: theme.subjectTags,
    culturalTags: theme.culturalTags,
    rightsStatus: "editorial_only",
    modelReleaseStatus: "not_required",
    propertyReleaseStatus: "not_required",
    authenticityConfidence: 1,
    humanVerified: true,
    contributor: "Local search test library",
    workflowStage: "approval",
    aiTags: [...theme.subjectTags, ...theme.culturalTags],
    visualLocationType: theme.visualLocationType,
    primaryCategory: theme.primaryCategory,
    sceneAttributes: ["synthetic test metadata"],
    geographicLocationSource: "editor",
    assetRevision: 1,
    reviewedRevision: 1,
    approvedRevision: 1,
    curatorNotes: "Local-only synthetic search fixture. Do not publish or license.",
    metadataReviewStatus: "reviewed",
    metadataReviewNote: "Synthetic metadata used to exercise prompt search and empty results.",
    metadataProvenance: "editor",
    sourceFileName: null,
    sourceLicense: "Local test fixture",
    sourceAttribution: "Veld Archive development team",
    previewUrl: null,
    monetizationModel: "membership",
    licensePriceCents: null,
  };
});
