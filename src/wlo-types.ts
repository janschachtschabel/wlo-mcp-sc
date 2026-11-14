/**
 * wlo-types.ts – The shared shapes of an edu-sharing node and a search response.
 *
 * A leaf with no imports, so every layer (config, fetch, search, node, services,
 * tools) can name the same node without pulling the fetch stack in behind it.
 */

export interface SearchCriterion {
  property: string;
  values: string[];
}

export interface WloNode {
  ref?: { id: string; repo: string };
  name?: string;
  title?: string;
  isDirectory?: boolean;
  /**
   * Whether GROUP_EVERYONE can read the node. Present in every search DTO
   * regardless of `propertyFilter` (top-level field, measured 2026-08-22).
   * `false` means an ANONYMOUS request — a widget's `<img>`, an unauthenticated
   * metadata read — gets 403 resp. the repository's permission-shield image.
   */
  isPublic?: boolean;
  /** edu-sharing object type — `ccm:io` (a record) or `ccm:map` (a CONTAINER: a collection, but also a page-config or crawler folder — see `node-kind.ts`). */
  type?: string;
  /** The node's aspects — top-level in every DTO, whatever the `propertyFilter` (measured 2026-11-12). `ccm:collection` marks a collection. */
  aspects?: string[];
  /**
   * For a REFERENCE node (one created by filing material into a collection):
   * the id of the original it points at. Absent on originals. Collection
   * listings hand out reference ids, and several endpoints — the usage lookup
   * above all — only know the original, so this is the field that bridges them.
   */
  originalId?: string;
  /** Creation time as ISO 8601 — in listings AND metadata (measured 2026-11-06); `cm:created` holds the same as epoch ms. */
  createdAt?: string;
  /** MIME type, e.g. `application/pdf` (only on `ccm:io` nodes). */
  mimetype?: string;
  /** Coarse mediatype label, e.g. `file-pdf`, `file-video`. */
  mediatype?: string;
  /** File size in bytes (only on file nodes with binary content). The live
   *  API serialises this as a STRING — consumers must coerce (formatter). */
  size?: number | string;
  /** Direct binary download URL — works without auth; null if no binary content. */
  downloadUrl?: string | null;
  properties?: Record<string, string[]>;
  preview?: {
    url?: string;
    /** `true` = generic mediatype icon, `false` = real generated thumbnail */
    isIcon?: boolean;
    isGenerated?: boolean;
  };
  /**
   * In-repo viewer URL (PDF/video preview component). Null when the node
   * has no binary attachment (e.g. external link nodes via `ccm:wwwurl`).
   */
  content?: { url?: string; originalUrl?: string; hash?: string; version?: string };
  /** Present on collection hits from the collections SEARCH query (with child
   *  counts); a metadata read sends no `collection` object at all (measured
   *  2026-08-22) — so a count is trusted when present and never inferred. */
  collection?: { description?: string; title?: string; childCollectionsCount?: number; childReferencesCount?: number };
}

export interface SearchResponse {
  nodes: WloNode[];
  pagination: { total: number; from: number; count: number };
  /**
   * Set by the searches that are PAGED in windows: `true` when no source of
   * this window returned a full one, so the next window holds nothing.
   * `pagination.total` cannot stand in for it — it counts one query variant
   * (resp. the exact licence) while the paging runs over all variants (resp.
   * the licence family). See `services/content-search.ts`.
   */
  exhausted?: boolean;
  /**
   * A ranked search whose query VARIANTS did not all answer: the window is what
   * the others returned. Neither "no hits" nor "there is more" is a finding
   * over it (review 2026-11-15).
   */
  incomplete?: boolean;
  /**
   * Facet aggregation buckets, only present when `ngsearch` was called with
   * `facets`. Values are property URIs with their document counts (no
   * server-side labels — resolve via `resolveFacetCounts`).
   */
  facets?: { property: string; values: { value: string; count: number }[] }[];
}
