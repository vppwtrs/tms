import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number
}

function base({ size = 18, ...props }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  }
}

export const IconDashboard = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
)

export const IconTruck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 6h11v10H3z" />
    <path d="M14 10h4l3 3v3h-7z" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </svg>
)

export const IconRoute = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="19" r="2.5" />
    <circle cx="18" cy="5" r="2.5" />
    <path d="M8.5 19H14a3.5 3.5 0 0 0 0-7H9.5a3.5 3.5 0 0 1 0-7h5.5" />
  </svg>
)

export const IconClipboard = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
    <path d="M9 11h6M9 15h6M9 7h4" />
  </svg>
)

export const IconPencil = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    <path d="M15 5l4 4" />
  </svg>
)

export const IconSparkle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.9 2.4L22.3 18.3l-2.4.9L19 21.6l-.9-2.4-2.4-.9 2.4-.9z" />
  </svg>
)

export const IconUsers = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M16 15.5c2.7.2 4.6 1.8 5.3 4.5" />
  </svg>
)

export const IconBuilding = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="3" width="12" height="18" rx="1.5" />
    <path d="M8 7h2M8 11h2M8 15h2" />
    <path d="M16 9h3v12h-3" />
  </svg>
)

export const IconChart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <rect x="7" y="12" width="3" height="6" rx="0.5" />
    <rect x="12" y="8" width="3" height="10" rx="0.5" />
    <rect x="17" y="5" width="3" height="13" rx="0.5" />
  </svg>
)

export const IconGear = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.3 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.3 2.6h4l.3-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z" />
  </svg>
)

export const IconLogout = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
)

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

export const IconEdit = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)

export const IconMerge = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 21V9a4 4 0 0 1 4-4h6" />
    <path d="M17 21V9a4 4 0 0 0-4-4H7" />
    <path d="M14 8l3-3-3-3" />
  </svg>
)

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l10 18H2z" />
    <path d="M12 10v4M12 17.5v.5" />
  </svg>
)

export const IconInfo = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.5" />
  </svg>
)

export const IconClock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const IconPin = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
)

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
)

export const IconMenu = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const IconChevronLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

export const IconChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 18l6-6-6-6" />
  </svg>
)

export const IconPhone = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z" />
  </svg>
)

export const IconBox = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
    <path d="M3 8l9 5 9-5M12 13v8" />
  </svg>
)

export const IconTruckBig = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7h11v9H3z" />
    <path d="M14 10h3.5l2.5 2.8V16H14z" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="16.5" cy="17.5" r="1.8" />
  </svg>
)

export const IconWallet = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 7H5a2 2 0 0 1 0-4h13v4" />
    <path d="M20 7v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
    <path d="M16 13h2" />
  </svg>
)

export const IconFlag = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 22V4a1 1 0 0 1 1-1h11l-2 3 2 3H5" />
  </svg>
)

export const IconFileText = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M9 13h6M9 17h6M9 9h1" />
  </svg>
)

export const IconTable = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M10 4v16M16 4v16" />
  </svg>
)

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v12" />
    <path d="M7 11l5 5 5-5" />
    <path d="M4 19h16" />
  </svg>
)

export const IconPrinter = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 9V3h12v6" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="7" rx="1" />
  </svg>
)

export const IconShield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5.5c0 4.3-2.9 8-7 9.5-4.1-1.5-7-5.2-7-9.5V6z" />
    <path d="M9.2 12.2l2 2 3.6-3.9" />
  </svg>
)

export const IconKey = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.9 12.1L20 3" />
    <path d="M17 6l2.5 2.5M15 8l2 2" />
  </svg>
)

export const IconSun = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const IconMoon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.7 6.7 0 0 0 10.5 10.5z" />
  </svg>
)

/* ลูกศรพับเมนู — เส้นตั้งคือขอบ sidebar ลูกศรบอกทิศที่กำลังจะไป */
export const IconPanelLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
)
