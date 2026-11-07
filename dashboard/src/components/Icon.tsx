import type { CSSProperties } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Award,
  Bookmark,
  Box,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleUserRound,
  Clipboard,
  Clock,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  File,
  FileText,
  Filter,
  Globe,
  GraduationCap,
  LayoutGrid,
  Lightbulb,
  Link as LinkIcon,
  List,
  Lock,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Moon,
  Pencil,
  Plus,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  User,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'

// Central icon registry (Lucide under the hood). We keep the string-name API
// the app already uses — including names passed dynamically as props from nav
// configs (e.g. `<Icon name={icon} />`) — so there's a single place to add or
// swap an icon. The legacy kebab-case keys mirror the old Ionicons names so the
// migration was a mechanical tag rename at every call site.
const ICONS: Record<string, LucideIcon> = {
  'add-circle-outline': PlusCircle,
  'add-outline': Plus,
  'alert-circle-outline': AlertCircle,
  'arrow-forward-outline': ArrowRight,
  'bookmark-outline': Bookmark,
  'briefcase-outline': Briefcase,
  'build-outline': Wrench,
  'bulb-outline': Lightbulb,
  'business-outline': Building2,
  'calendar-outline': Calendar,
  'checkmark-circle': CheckCircle2,
  'checkmark-circle-outline': CheckCircle2,
  'checkmark-outline': Check,
  'chevron-down-outline': ChevronDown,
  'chevron-forward-outline': ChevronRight,
  'chevron-up-outline': ChevronUp,
  'clipboard-outline': Clipboard,
  'close-outline': X,
  'copy-outline': Copy,
  'create-outline': Pencil,
  'cube-outline': Box,
  'document-outline': File,
  'document-text-outline': FileText,
  'download-outline': Download,
  'ellipse-outline': Circle,
  'enter-outline': LogIn,
  'eye-outline': Eye,
  'funnel-outline': Filter,
  'globe-outline': Globe,
  'grid-outline': LayoutGrid,
  'hardware-chip-outline': Cpu,
  'link-outline': LinkIcon,
  'list-outline': List,
  'location-outline': MapPin,
  'lock-closed-outline': Lock,
  'log-out-outline': LogOut,
  'mail-outline': Mail,
  'menu-outline': Menu,
  'moon-outline': Moon,
  'open-outline': ExternalLink,
  'options-outline': SlidersHorizontal,
  'people-outline': Users,
  'person-circle-outline': CircleUserRound,
  'person-outline': User,
  'refresh-outline': RefreshCw,
  'ribbon-outline': Award,
  'save-outline': Save,
  'school-outline': GraduationCap,
  'search-outline': Search,
  'settings-outline': Settings,
  'shield-checkmark-outline': ShieldCheck,
  'sparkles-outline': Sparkles,
  'sunny-outline': Sun,
  'time-outline': Clock,
  'trash-outline': Trash2,
  'wallet-outline': Wallet,
}

export interface IconProps {
  name: string
  // Pixel/length size. Omit to inherit the surrounding text size (1em), matching
  // the old <ion-icon> default; container CSS (svg width/height rules) still wins.
  size?: number | string
  className?: string
  style?: CSSProperties
  // Pass-through for a11y / data-* attributes used at call sites.
  'aria-label'?: string
  'aria-hidden'?: boolean | 'true' | 'false'
  'data-slot'?: string
}

export function Icon({ name, size, className, style, ...rest }: IconProps) {
  const Cmp = ICONS[name]
  if (!Cmp) {
    if (import.meta.env.DEV) console.warn(`[Icon] unknown icon name: "${name}"`)
    return null
  }
  // Preserve the old `<ion-icon style={{ fontSize }}>` sizing contract so callers
  // that sized via fontSize keep working untouched; default to 1em otherwise.
  const resolvedSize =
    size ?? (typeof style?.fontSize === 'number' ? style.fontSize : undefined) ?? '1em'
  return <Cmp className={className} size={resolvedSize} style={style} {...rest} />
}
