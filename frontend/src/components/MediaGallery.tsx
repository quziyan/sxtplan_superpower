import type { MediaAsset } from '@/lib/media-api'

// Plan-C T27 / ISC-35: per-dispatch media tile grid. Used inline by
// DispatchPanel; stays a pure presentational component so it can be reused
// later if a per-dispatch detail page lands.
//
// Field nullability: the underlying DB columns are nullable for sizeBytes /
// sha256 / retentionUntil (see media-api.ts). We render whatever data is
// present and fall back gracefully when it isn't.
export function MediaGallery({ mediaAssets }: { mediaAssets: MediaAsset[] }) {
  if (mediaAssets.length === 0) {
    return (
      <div className="media-gallery">
        <p className="text-muted">无回传媒体</p>
      </div>
    )
  }

  return (
    <div className="media-gallery">
      {mediaAssets.map((m) => {
        const sizeKb = m.sizeBytes != null ? (m.sizeBytes / 1024).toFixed(1) : null
        const shaShort = m.sha256 != null ? m.sha256.slice(0, 8) : null
        const altText = shaShort ?? m.id.slice(0, 8)
        return (
          <a
            key={m.id}
            href={m.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="media-tile"
          >
            {m.mediaType === 'image' ? (
              <img src={m.sourceUrl} alt={altText} className="media-tile__img" />
            ) : (
              <div className="media-tile__placeholder">{m.mediaType}</div>
            )}
            <div className="media-tile__caption">
              {sizeKb !== null && <span>{sizeKb} KB</span>}
              {sizeKb !== null && shaShort !== null && <span> · </span>}
              {shaShort !== null && <span className="id-cell">{shaShort}</span>}
              {sizeKb === null && shaShort === null && <span className="text-muted">—</span>}
            </div>
          </a>
        )
      })}
    </div>
  )
}
