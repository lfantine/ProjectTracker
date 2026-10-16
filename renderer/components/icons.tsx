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
    <path d="m9.5 3-.5 2a7.5 7.5 0 0 0-1.6.9l-2-.6-2.5 4.3 1.5 1.4a7.5 7.5 0 0 0 0 1.9l-1.5 1.4L5.4 19l2-.6a7.5 7.5 0 0 0 1.6.9l.5 2h5l.5-2a7.5 7.5 0 0 0 1.6-.9l2 .6 2.5-4.3-1.5-1.4a7.5 7.5 0 0 0 0-1.9l1.5-1.4L18.6 5.3l-2 .6A7.5 7.5 0 0 0 15 5l-.5-2z" />
    <circle cx="12" cy="12" r="3" />
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

export const ChartIcon = makeIcon(
  <>
    <path d="M4 4.5v15h16" />
    <path d="M8 16v-4M12 16V8M16 16v-6" />
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

export const PageIcon = makeIcon(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M3.5 9h17M8 9v10.5" />
  </>
)

export const WidgetIcon = makeIcon(
  <>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="4" rx="1.5" />
    <rect x="13" y="10" width="7" height="10" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
  </>
)

export const BlockIcon = makeIcon(
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 9h8M8 13h5" />
  </>
)

export const PaletteIcon = makeIcon(
  <>
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.5 1.6-1.5h2.1a3.9 3.9 0 0 0 4-4C20.5 7 16.7 3.5 12 3.5z" />
    <circle cx="7.8" cy="11" r="1" />
    <circle cx="10.5" cy="7.5" r="1" />
    <circle cx="15" cy="7.8" r="1" />
  </>
)

export const PuzzleIcon = makeIcon(
  <path d="M9 4.5h3.5v2a1.75 1.75 0 1 0 3.5 0v-2H19.5V9h-2a1.75 1.75 0 1 0 0 3.5h2v7H16v-2a1.75 1.75 0 1 0-3.5 0v2H4.5V16h2a1.75 1.75 0 1 0 0-3.5h-2V4.5z" />
)

export const RefreshIcon = makeIcon(
  <>
    <path d="M19.5 12a7.5 7.5 0 0 1-13.1 5" />
    <path d="M4.5 12a7.5 7.5 0 0 1 13.1-5" />
    <path d="M17.8 3.5v3.7h-3.7M6.2 20.5v-3.7h3.7" />
  </>
)

export const UploadIcon = makeIcon(
  <>
    <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" />
    <path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" />
  </>
)

export const ShieldIcon = makeIcon(
  <path d="M12 3.5 5 6.2v5.3c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6.2z" />
)

export const StarIcon = makeIcon(<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8z" />)
export const HeartIcon = makeIcon(<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" />)
export const FlagIcon = makeIcon(<><path d="M5.5 20.5V4" /><path d="M5.5 4.5h11l-2 4 2 4h-11" /></>)
export const BookmarkIcon = makeIcon(<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />)
export const BellIcon = makeIcon(<><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>)
export const MailIcon = makeIcon(<><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>)
export const MessageIcon = makeIcon(<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-9l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z" />)
export const UserIcon = makeIcon(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>)
export const UsersIcon = makeIcon(<><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M15.5 6.3a3 3 0 0 1 0 5.4M17 14.2a5.5 5.5 0 0 1 3.5 4.8" /></>)
export const BriefcaseIcon = makeIcon(<><rect x="3.5" y="7.5" width="17" height="12" rx="2" /><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" /></>)
export const BookIcon = makeIcon(<><path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H7.5A2.5 2.5 0 0 1 5 17z" /><path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H18" /></>)
export const GraduationIcon = makeIcon(<><path d="M2.5 9.5 12 5l9.5 4.5L12 14z" /><path d="M6.5 11.5v4c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4M21.5 9.5v5" /></>)
export const LightbulbIcon = makeIcon(<><path d="M9.5 17.5h5M10.5 20.5h3" /><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2v1.2h5.2v-1.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.5z" /></>)
export const TargetIcon = makeIcon(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>)
export const RocketIcon = makeIcon(<><path d="M14 5c3-1.5 6-1 6-1s.5 3-1 6l-6 6-5-5z" /><path d="M8.5 11H5l-1.5 2.5 4 1M13 15.5V19l-2.5 1.5-1-4" /><path d="M6 18c-1 1-1.5 2.5-1.5 2.5S6 20 7 19" /><circle cx="15.5" cy="8.5" r="1.3" /></>)
export const TrophyIcon = makeIcon(<><path d="M8 4.5h8v5a4 4 0 0 1-8 0z" /><path d="M8 6.5H5a3 3 0 0 0 3 4M16 6.5h3a3 3 0 0 1-3 4M12 13.5v3.5M8.5 20.5h7M10 17h4v3.5h-4z" /></>)
export const ZapIcon = makeIcon(<path d="M13 3.5 5 13.5h6l-1 7 8-10h-6z" />)
export const ClockIcon = makeIcon(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>)
export const MapIcon = makeIcon(<><path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z" /><path d="M9 4.5v13M15 6.5v13" /></>)
export const GlobeIcon = makeIcon(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" /></>)
export const MusicIcon = makeIcon(<><path d="M9 17.5v-12l10.5-2v12" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="17" cy="15.5" r="2.5" /></>)
export const CameraIcon = makeIcon(<><path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>)
export const CoffeeIcon = makeIcon(<><path d="M4.5 9h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" /><path d="M16.5 10.5H18a2.5 2.5 0 0 1 0 5h-1.8M8 3.5V6M11.5 3.5V6" /></>)
export const GiftIcon = makeIcon(<><rect x="4" y="12" width="16" height="8" rx="1.5" /><path d="M3 8.5h18V12H3zM12 8.5V20" /><path d="M12 8.5C10.5 5.5 7 5 7 7.3 7 8.5 9.5 8.5 12 8.5zm0 0c1.5-3 5-3.5 5-1.2 0 1.2-2.5 1.2-5 1.2z" /></>)
export const WalletIcon = makeIcon(<><path d="M4 7.5a2 2 0 0 1 2-2h11.5v3" /><rect x="4" y="8.5" width="16.5" height="11" rx="2" /><path d="M16 14h1.5" /></>)
export const DumbbellIcon = makeIcon(<path d="M7.5 7v10M16.5 7v10M4.5 9.5v5M19.5 9.5v5M7.5 12h9" />)
export const LeafIcon = makeIcon(<><path d="M5 19c0-8 5-13.5 14.5-14 0 9.5-5.5 14.5-13 14.5" /><path d="M5 19c3-4 6-6.5 9.5-8" /></>)
export const LinkedinIcon = makeIcon(<><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M8 10.5v6M8 7.6v.1M11.5 16.5v-6M11.5 13c0-1.6 1-2.6 2.5-2.6s2.5 1 2.5 2.6v3.5" /></>)
export const CloudIcon = makeIcon(<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18.5z" />)
export const LockIcon = makeIcon(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" /></>)
export const PhoneIcon = makeIcon(<><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 17.5h2" /></>)
