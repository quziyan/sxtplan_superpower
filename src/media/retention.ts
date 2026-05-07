const RETENTION_DAYS = 365

/**
 * Compute the retention cutoff for a media asset.
 * Default policy: keep media for 365 days after fetch.
 */
export function computeRetentionUntil(now: Date = new Date()): Date {
  return new Date(now.getTime() + RETENTION_DAYS * 86_400_000)
}

export { RETENTION_DAYS }
