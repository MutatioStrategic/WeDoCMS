// D1 limits a result set to 100 columns. The assets table currently has 100
// columns, so SELECT a.* plus the contributor join fails in production. Keep
// this projection explicit; source_download_url is retained in D1 but is not
// consumed by the asset domain responses.
export const assetWithContributorSelect = [
  "a.id", "a.owner_id", "a.kind", "a.status", "a.title", "a.description", "a.caption", "a.country", "a.province", "a.city", "a.locality", "a.landmark",
  "a.subject_tags", "a.cultural_tags", "a.rights_status", "a.model_release_status", "a.property_release_status", "a.authenticity_confidence", "a.human_verified",
  "a.original_key", "a.preview_key", "a.stream_uid", "a.created_at", "a.updated_at", "a.workflow_stage", "a.ai_tags", "a.curator_notes", "a.source_file_name",
  "a.last_reviewed_at", "a.ai_confidence", "a.metadata_review_status", "a.metadata_review_note", "a.metadata_provenance", "a.ocr_text", "a.vector_index_status",
  "a.vector_indexed_at", "a.vector_index_version", "a.organization_id", "a.monetization_model", "a.license_price_cents", "a.source_url", "a.source_license",
  "a.source_attribution", "a.demo_seed", "a.asset_revision", "a.source_etag", "a.enriched_revision", "a.reviewed_revision", "a.approved_revision", "a.indexed_revision",
  "a.vector_index_id", "a.index_terminal_reason", "a.visual_location_type", "a.primary_category", "a.scene_attributes", "a.detected_language", "a.text_readability",
  "a.ocr_confidence", "a.ai_field_confidences", "a.enrichment_validation_json", "a.geographic_location_source", "a.preview_640_key", "a.preview_1200_key",
  "a.video_poster_key", "a.ai_metadata_suggestion_json", "a.ai_metadata_suggestion_revision", "a.ai_metadata_suggestion_etag", "a.candidate_vector_status",
  "a.candidate_vector_indexed_at", "a.candidate_vector_version", "a.candidate_vector_id", "a.scene_context", "a.media_content_type", "a.media_width", "a.media_height",
  "a.media_duration_seconds", "a.media_orientation", "a.media_has_people", "a.media_usage_type", "a.media_ai_generated", "a.artist_license_key",
  "a.artist_license_version", "a.artist_license_url", "a.artist_license_terms", "a.artist_license_sha256", "a.artist_license_accepted_at", "a.free_download_enabled",
  "a.stream_status", "a.stream_progress", "a.stream_error_code", "a.stream_error_text", "a.stream_updated_at", "a.stream_ready_at", "a.license_credit_cost",
  "a.subscription_included", "a.author_approval_revision", "a.author_approved_by", "a.author_approved_at", "a.editor_media_acceptable", "u.display_name AS contributor",
].join(", ");
