import React from 'react'

export interface IconProps {
  size?: number
  className?: string
}

function makeIcon(children: React.ReactNode, viewBox = '0 0 24 24') {
  return function IconComponent({ size = 18, className }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        {children}
      </svg>
    )
  }
}

export const HomeIcon = makeIcon(
  <>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
  </>
)

export const FolderIcon = makeIcon(
  <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h9a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
)

export const NoteIcon = makeIcon(
  <>
    <path d="M6 3.5h9l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
    <path d="M14.5 3.5V8H19" />
    <path d="M8 12h7M8 15.3h7M8 8.7h3" />
  </>
)

export const AlertIcon = makeIcon(
  <>
    <path d="M10.6 4.3a1.6 1.6 0 0 1 2.8 0l8 14.2a1.6 1.6 0 0 1-1.4 2.4H4a1.6 1.6 0 0 1-1.4-2.4z" />
    <path d="M12 9.5v4.2" />
    <path d="M12 17h.01" />
  </>
)

export const SearchIcon = makeIcon(
  <>
    <circle cx="10.6" cy="10.6" r="6.6" />
    <path d="M20 20l-4.8-4.8" />
  </>
)

export const SettingsIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M4.4 4.4l1.7 1.7M17.9 17.9l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.4 19.6l1.7-1.7M17.9 6.1l1.7-1.7" />
  </>
)

export const SparklesIcon = makeIcon(
  <>
    <path d="M11 2.5 12.6 8l5.4 1.6-5.4 1.6L11 16.7 9.4 11.2 4 9.6l5.4-1.6z" />
    <path d="M18.5 15.5 19.2 18l2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" />
  </>
)

export const PlusIcon = makeIcon(<path d="M12 5v14M5 12h14" />)

export const XIcon = makeIcon(<path d="M6 6l12 12M18 6 6 18" />)

export const ChevronRightIcon = makeIcon(<path d="M9 6l6 6-6 6" />)

export const ChevronDownIcon = makeIcon(<path d="M6 9l6 6 6-6" />)

export const ArrowLeftIcon = makeIcon(<path d="M19 12H5M11 6l-6 6 6 6" />)

export const ExternalLinkIcon = makeIcon(
  <>
    <path d="M9 6H6a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 6 19h10a1.5 1.5 0 0 0 1.5-1.5V15" />
    <path d="M14 4.5h5.5V10M19 5l-9.5 9.5" />
  </>
)

export const TrashIcon = makeIcon(
  <>
    <path d="M4 6.5h16" />
    <path d="M8.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v1.5" />
    <path d="M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5" />
  </>
)

export const CalendarIcon = makeIcon(
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="1.6" />
    <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
  </>
)

export const TerminalIcon = makeIcon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="1.8" />
    <path d="M7 9l3 3-3 3M12.5 15h4.5" />
  </>
)

export const CodeIcon = makeIcon(<path d="M9 8 4.5 12 9 16M15 8l4.5 4-4.5 4" />)

export const FolderOpenIcon = makeIcon(
  <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h8a1.5 1.5 0 0 1 1.48 1.75l-1.1 7A1.5 1.5 0 0 1 17.4 18H5a1.5 1.5 0 0 1-1.48-1.26z" />
)

export const LinkIcon = makeIcon(
  <>
    <path d="M9.5 14.5l5-5" />
    <path d="M8 16.8 6.2 18.6a3 3 0 0 1-4.2-4.2L5 11.4M16 7.2l3-3a3 3 0 0 1 4.2 4.2L20.2 11" />
  </>
)

export const SunIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5" />
  </>
)

export const MoonIcon = makeIcon(
  <path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a6.7 6.7 0 0 0 10.2 10.2Z" />
)

export const MonitorIcon = makeIcon(
  <>
    <rect x="3" y="4.5" width="18" height="12" rx="1.6" />
    <path d="M8.5 20h7M12 16.5V20" />
  </>
)

export const CheckIcon = makeIcon(<path d="M5 12.5l4.5 4.5L19 7" />)

export const PencilIcon = makeIcon(
  <>
    <path d="M15.2 4.8 19.2 8.8 8.5 19.5H4.5v-4z" />
    <path d="M13.5 6.5l3.6 3.6" />
  </>
)

export const GripIcon = makeIcon(
  <>
    <circle cx="9" cy="6" r="1.3" />
    <circle cx="9" cy="12" r="1.3" />
    <circle cx="9" cy="18" r="1.3" />
    <circle cx="15" cy="6" r="1.3" />
    <circle cx="15" cy="12" r="1.3" />
    <circle cx="15" cy="18" r="1.3" />
  </>
)

export const PinIcon = makeIcon(
  <>
    <path d="M14.5 3.5 20 9l-3 3-1.3-.3-3.6 3.6.4 3.2-1.5 1.5-4-4-4 4-1-1 4-4-4-4 1.5-1.5 3.2.4 3.6-3.6L9.5 7Z" />
  </>
)

export const ImageIcon = makeIcon(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17.5 9 12l3.3 3.3L15.5 12 20 16.5" />
  </>
)

export const VideoIcon = makeIcon(
  <>
    <rect x="2.5" y="6" width="13" height="12" rx="1.8" />
    <path d="M15.5 10.2 21 7.3v9.4l-5.5-2.9Z" />
  </>
)

export const StoreIcon = makeIcon(
  <>
    <path d="M4 9.5 5.2 4.5h13.6L20 9.5" />
    <path d="M4 9.5a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" />
    <path d="M5 9.8V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.8" />
    <path d="M9.5 20v-5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V20" />
  </>
)

export const ShoppingBagIcon = makeIcon(
  <>
    <path d="M6 8h12l-1 12.5a1.5 1.5 0 0 1-1.5 1.3H8.5A1.5 1.5 0 0 1 7 20.5z" />
    <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </>
)
