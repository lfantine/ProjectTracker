import type { HostIcon } from '../../shared/version'
import {
  HomeIcon, FolderIcon, NoteIcon, AlertIcon, SearchIcon, SettingsIcon, SparklesIcon, CalendarIcon, TerminalIcon, CodeIcon, LinkIcon, ImageIcon, ChartIcon, VideoIcon, StoreIcon, ShoppingBagIcon, CheckIcon, PinIcon,
  StarIcon, HeartIcon, FlagIcon, BookmarkIcon, BellIcon, MailIcon, MessageIcon, UserIcon, UsersIcon, BriefcaseIcon, BookIcon, GraduationIcon, LightbulbIcon, TargetIcon, RocketIcon, TrophyIcon,
  ZapIcon, ClockIcon, MapIcon, GlobeIcon, MusicIcon, CameraIcon, CoffeeIcon, GiftIcon, WalletIcon, DumbbellIcon, LeafIcon, PaletteIcon, PuzzleIcon, LinkedinIcon,
  ShieldIcon, SunIcon, MoonIcon, CloudIcon, LockIcon, PhoneIcon,
} from './icons'
export const SHORTCUT_ICONS = {
  home: { icon: HomeIcon, label: 'Accueil' }, folder: { icon: FolderIcon, label: 'Dossier' }, note: { icon: NoteIcon, label: 'Note' }, alert: { icon: AlertIcon, label: 'Alerte' }, search: { icon: SearchIcon, label: 'Recherche' }, settings: { icon: SettingsIcon, label: 'Réglages' }, sparkles: { icon: SparklesIcon, label: 'Inspiration' }, calendar: { icon: CalendarIcon, label: 'Calendrier' }, terminal: { icon: TerminalIcon, label: 'Terminal' }, code: { icon: CodeIcon, label: 'Code' }, link: { icon: LinkIcon, label: 'Lien' }, image: { icon: ImageIcon, label: 'Image' }, chart: { icon: ChartIcon, label: 'Statistiques' }, video: { icon: VideoIcon, label: 'Vidéo' }, store: { icon: StoreIcon, label: 'Boutique' }, 'shopping-bag': { icon: ShoppingBagIcon, label: 'Sac' }, check: { icon: CheckIcon, label: 'Validation' }, pin: { icon: PinIcon, label: 'Épingle' },
  star: { icon: StarIcon, label: 'Étoile' }, heart: { icon: HeartIcon, label: 'Cœur' }, flag: { icon: FlagIcon, label: 'Drapeau' }, bookmark: { icon: BookmarkIcon, label: 'Signet' }, bell: { icon: BellIcon, label: 'Cloche' }, mail: { icon: MailIcon, label: 'E-mail' }, message: { icon: MessageIcon, label: 'Message' }, user: { icon: UserIcon, label: 'Personne' }, users: { icon: UsersIcon, label: 'Équipe' }, briefcase: { icon: BriefcaseIcon, label: 'Travail' }, book: { icon: BookIcon, label: 'Livre' }, graduation: { icon: GraduationIcon, label: 'Études' }, lightbulb: { icon: LightbulbIcon, label: 'Idée' }, target: { icon: TargetIcon, label: 'Objectif' }, rocket: { icon: RocketIcon, label: 'Lancement' },
  trophy: { icon: TrophyIcon, label: 'Trophée' }, zap: { icon: ZapIcon, label: 'Éclair' }, clock: { icon: ClockIcon, label: 'Horloge' }, map: { icon: MapIcon, label: 'Carte' }, globe: { icon: GlobeIcon, label: 'Web' }, music: { icon: MusicIcon, label: 'Musique' }, camera: { icon: CameraIcon, label: 'Photo' }, coffee: { icon: CoffeeIcon, label: 'Café' }, gift: { icon: GiftIcon, label: 'Cadeau' }, wallet: { icon: WalletIcon, label: 'Finances' }, dumbbell: { icon: DumbbellIcon, label: 'Sport' }, leaf: { icon: LeafIcon, label: 'Nature' }, palette: { icon: PaletteIcon, label: 'Design' }, puzzle: { icon: PuzzleIcon, label: 'Extension' }, linkedin: { icon: LinkedinIcon, label: 'LinkedIn' },
  shield: { icon: ShieldIcon, label: 'Sécurité' }, sun: { icon: SunIcon, label: 'Soleil' }, moon: { icon: MoonIcon, label: 'Nuit' }, cloud: { icon: CloudIcon, label: 'Nuage' }, lock: { icon: LockIcon, label: 'Privé' }, phone: { icon: PhoneIcon, label: 'Téléphone' },
} satisfies Record<HostIcon, { icon: typeof HomeIcon; label: string }>
// The picker shows this many first, the rest behind « Voir plus ».
export const SHORTCUT_ICONS_SHORTLIST = 18
export function ShortcutIcon({ name, size = 18 }: { name: HostIcon; size?: number }) {
  const Icon = SHORTCUT_ICONS[name]?.icon ?? NoteIcon
  return <Icon size={size} />
}
