import * as stylex from '@stylexjs/stylex';
import { styles } from '../app.stylex';
import { Icon } from './Icon';

/** The same first-four layout is used on cards and in the editor; the editor opens images in the preview. */
export function ImageMosaic({ images, editor = false, onOpen, labels }: {
  images: React.ReactNode[]; editor?: boolean; labels?: string[];
  onOpen?: (index: number) => void;
}) {
  return <span {...stylex.props(styles.imageMosaic, editor && styles.editorMosaic, images.length === 2 && styles.mosaicTwo)}>
    {images.slice(0, 4).map((image, index) => <span key={index} {...stylex.props(styles.mosaicTile, images.length === 3 && index === 2 && styles.mosaicWide)}>
      {onOpen ? <button type="button" aria-label={`View ${labels?.[index] ?? 'image'} ${index + 1}`} onClick={() => onOpen(index)} {...stylex.props(styles.mosaicOpen)}>{image}</button> : image}
      {index === 3 && images.length > 4 && <span {...stylex.props(styles.mosaicMore)}><Icon name="image" width={18}/>{images.length - 4} more {images.length === 5 ? 'image' : 'images'}</span>}
    </span>)}
  </span>;
}
