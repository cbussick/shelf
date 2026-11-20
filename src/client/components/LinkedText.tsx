import * as stylex from '@stylexjs/stylex';
import { styles } from '../app.stylex';
import type { TextPart } from './link-parts';

export function LinkedText({ parts }: { parts: Array<TextPart> }) {
  return <>{parts.map((part, index) => part.href
    ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.noteLink)}>{part.text}</a>
    : part.text)}</>;
}
