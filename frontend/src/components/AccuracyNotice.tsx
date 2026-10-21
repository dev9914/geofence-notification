import { TriangleAlert } from 'lucide-react'
import { formatMeters } from '../utils/format'

export interface AccuracyNoticeProps {
  /** Accuracy of the most recent reading, or `null` before the first one. */
  accuracyMeters: number | null
  /** Backend policy threshold above which a reading cannot confirm a position. */
  thresholdMeters: number
}

/** Warns when the reported GPS accuracy is worse than the backend's threshold. */
export default function AccuracyNotice({ accuracyMeters, thresholdMeters }: AccuracyNoticeProps) {
  if (accuracyMeters === null || accuracyMeters <= thresholdMeters) {
    return null
  }

  return (
    <p className="notice notice--warning" role="status">
      <TriangleAlert size={16} aria-hidden="true" />
      <span>
        Low GPS accuracy: the device reports ±{formatMeters(accuracyMeters)}, which is worse than
        the {formatMeters(thresholdMeters, 0)} threshold. This reading is treated as uncertain, so
        it cannot confirm an entry or an exit.
      </span>
    </p>
  )
}
