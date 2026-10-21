import type { ReactNode } from 'react'
import {
  Ban,
  CircleAlert,
  CircleCheck,
  Clock,
  Info,
  LoaderCircle,
  MapPin,
  TriangleAlert,
} from 'lucide-react'
import type { VisitorStatusKey, VisitorStatusView } from '../geofence/status'

const STATUS_ICONS: Record<VisitorStatusKey, ReactNode> = {
  unsupported: <TriangleAlert size={24} aria-hidden="true" />,
  denied: <Ban size={24} aria-hidden="true" />,
  idle: <Info size={24} aria-hidden="true" />,
  waiting: <LoaderCircle size={24} aria-hidden="true" />,
  unavailable: <TriangleAlert size={24} aria-hidden="true" />,
  timeout: <Clock size={24} aria-hidden="true" />,
  'geolocation-error': <TriangleAlert size={24} aria-hidden="true" />,
  inside: <CircleCheck size={24} aria-hidden="true" />,
  outside: <MapPin size={24} aria-hidden="true" />,
  uncertain: <CircleAlert size={24} aria-hidden="true" />,
}

export interface StatusIndicatorProps {
  view: VisitorStatusView
}

/** Prominent geofence status indicator, announced to assistive technology when it changes. */
export default function StatusIndicator({ view }: StatusIndicatorProps) {
  return (
    <section className={`status status--${view.tone}`} aria-live="polite">
      <span className="status__icon">{STATUS_ICONS[view.key]}</span>
      <span className="status__text">
        <span className="status__label">{view.label}</span>
        <span className="status__detail">{view.detail}</span>
      </span>
    </section>
  )
}
