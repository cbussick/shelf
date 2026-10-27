import {
  AudioLines, Mic, Play, Pause, Square, Download, Upload, Search, Eye, EyeOff,
  ChevronLeft, ChevronRight, Plus, ListChecks, List, ListOrdered, ListIndentIncrease,
  ListIndentDecrease, Undo2, Redo2, Quote, Code, Link, Image, FileText, CloudCheck,
  CloudOff, RotateCcw, RotateCw, RefreshCw, X, Trash2, Pin, Palette, Heading, Bold, Italic,
} from 'lucide-react';
import type { SVGProps } from 'react';

// Explicit imports keep the bundle tree-shakable. Copyright and license notices
// for Lucide and Feather ship in public/THIRD_PARTY_NOTICES.txt.
const icons = {
  audio: AudioLines,
  microphone: Mic,
  play: Play,
  pause: Pause,
  stop: Square,
  download: Download,
  upload: Upload,
  search: Search,
  eye: Eye,
  'eye-off': EyeOff,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  plus: Plus,
  checklist: ListChecks,
  'list-bullet': List,
  'list-ordered': ListOrdered,
  indent: ListIndentIncrease,
  outdent: ListIndentDecrease,
  undo: Undo2,
  redo: Redo2,
  quote: Quote,
  code: Code,
  link: Link,
  image: Image,
  note: FileText,
  'cloud-check': CloudCheck,
  offline: CloudOff,
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  refresh: RefreshCw,
  x: X,
  trash: Trash2,
  pin: Pin,
  'pin-filled': Pin,
  palette: Palette,
  heading: Heading,
  bold: Bold,
  italic: Italic,
};

export function Icon({ name, ...props }: { name: keyof typeof icons } & SVGProps<SVGSVGElement>) {
  const Component = icons[name];
  const filled = name === 'pin-filled' || name === 'play' || name === 'stop';
  return <Component size={20} strokeWidth={1.6} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" focusable="false" {...props}/>;
}
