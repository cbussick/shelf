import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

const light = '#f7f8fa';
const dark = '#263630';

// Temporary, local-only probe for native Android navigation-bar contrast.
export function NavigationDiagnostics() {
  const [pageColor, setPageColor] = useState(light);
  const [themeColor, setThemeColor] = useState(light);
  const [environment, setEnvironment] = useState({ mode: 'Checking…', bottomInset: 'Checking…', height: 'Checking…' });
  const insetProbe = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const originalTheme = theme?.content;
    const originalTitle = document.title;
    const backgrounds = [document.documentElement, document.body].map(element => ({
      element,
      value: element.style.getPropertyValue('background-color'),
      priority: element.style.getPropertyPriority('background-color'),
    }));
    document.title = 'Navigation display test — Shelf';
    return () => {
      if (theme && originalTheme !== undefined) theme.content = originalTheme;
      document.title = originalTitle;
      for (const { element, value, priority } of backgrounds) {
        if (value) element.style.setProperty('background-color', value, priority);
        else element.style.removeProperty('background-color');
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.backgroundColor = pageColor;
    document.body.style.backgroundColor = pageColor;
  }, [pageColor]);

  useEffect(() => {
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (theme) theme.content = themeColor;
  }, [themeColor]);

  useEffect(() => {
    const measure = () => {
      const mode = ['standalone', 'minimal-ui', 'fullscreen'].find(value => matchMedia(`(display-mode: ${value})`).matches);
      setEnvironment({
        mode: mode ? `Installed app (${mode})` : 'Browser tab',
        bottomInset: insetProbe.current ? getComputedStyle(insetProbe.current).paddingBottom : 'Unknown',
        height: `${innerHeight}px / ${Math.round(visualViewport?.height ?? innerHeight)}px`,
      });
    };
    measure();
    addEventListener('resize', measure);
    visualViewport?.addEventListener('resize', measure);
    return () => {
      removeEventListener('resize', measure);
      visualViewport?.removeEventListener('resize', measure);
    };
  }, []);

  return <main {...stylex.props(testStyles.page)}>
    <span ref={insetProbe} aria-hidden="true" {...stylex.props(testStyles.insetProbe)}/>
    <section {...stylex.props(testStyles.panel)}>
      <a href="/" {...stylex.props(testStyles.back)}>Back to notes</a>
      <h1 {...stylex.props(testStyles.title)}>Navigation display test</h1>
      <p {...stylex.props(testStyles.copy)}>Start with both colours light. Change only the page to dark and screenshot the bottom Android buttons. Then try a light page with a dark system theme.</p>
      <fieldset {...stylex.props(testStyles.fieldset)}>
        <legend>Page background</legend>
        <div {...stylex.props(testStyles.choices)}>
          <button type="button" aria-pressed={pageColor === light} onClick={() => setPageColor(light)} {...stylex.props(testStyles.choice, pageColor === light && testStyles.selected)}>Light page</button>
          <button type="button" aria-pressed={pageColor === dark} onClick={() => setPageColor(dark)} {...stylex.props(testStyles.choice, pageColor === dark && testStyles.selected)}>Dark page</button>
        </div>
      </fieldset>
      <fieldset {...stylex.props(testStyles.fieldset)}>
        <legend>System theme colour</legend>
        <div {...stylex.props(testStyles.choices)}>
          <button type="button" aria-pressed={themeColor === light} onClick={() => setThemeColor(light)} {...stylex.props(testStyles.choice, themeColor === light && testStyles.selected)}>Light system theme</button>
          <button type="button" aria-pressed={themeColor === dark} onClick={() => setThemeColor(dark)} {...stylex.props(testStyles.choice, themeColor === dark && testStyles.selected)}>Dark system theme</button>
        </div>
      </fieldset>
      <dl aria-label="Test readings" aria-live="polite" {...stylex.props(testStyles.readings)}>
        {[
          ['Test version', 'Navigation v1'], ['Window', environment.mode],
          ['Page', pageColor], ['Theme', themeColor],
          ['Bottom safe area', environment.bottomInset], ['Layout / visual height', environment.height],
        ].map(([label, value]) => <div key={label} {...stylex.props(testStyles.reading)}><dt>{label}</dt><dd {...stylex.props(testStyles.value)}>{value}</dd></div>)}
      </dl>
      <button type="button" onClick={() => { setPageColor(light); setThemeColor(light); }} {...stylex.props(testStyles.reset)}>Reset test</button>
      <p {...stylex.props(testStyles.copy)}>No notes are changed. Colours reset when you leave. The system theme colour is a request to Chrome, not a guarantee that Android will use it.</p>
    </section>
    <p {...stylex.props(testStyles.bottomLabel, pageColor === dark && testStyles.lightText)}>Page background reaches this edge. Does it also reach behind the Android buttons?</p>
  </main>;
}

const testStyles = stylex.create({
  page: { minHeight: '100dvh', display: 'flex', flexDirection: 'column', gap: 24, padding: 'calc(16px + env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))' },
  panel: { width: '100%', maxWidth: 520, marginInline: 'auto', padding: 20, borderRadius: 14, backgroundColor: '#fff', color: dark },
  back: { display: 'inline-flex', alignItems: 'center', minHeight: 44, color: '#285b48', textUnderlineOffset: 3 },
  title: { margin: '8px 0 12px', fontSize: 24, lineHeight: 1.25, letterSpacing: -.6 },
  copy: { margin: '12px 0 0', fontSize: 13, lineHeight: 1.6 },
  fieldset: { borderWidth: 0, margin: '20px 0 0', padding: 0, fontSize: 14, fontWeight: 700, minWidth: 0 },
  choices: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 },
  choice: { minHeight: 48, padding: '8px 10px', border: '1px solid #646f67', borderRadius: 8, backgroundColor: '#fff', color: dark, fontSize: 13, lineHeight: 1.4 },
  selected: { backgroundColor: '#285b48', color: '#fff', borderColor: '#285b48' },
  readings: { display: 'grid', gap: 8, margin: '20px 0', fontSize: 12, lineHeight: 1.5 },
  reading: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0 12px' },
  value: { margin: 0, fontWeight: 700 },
  reset: { minHeight: 44, padding: '8px 14px', border: '1px solid #646f67', borderRadius: 8 },
  bottomLabel: { maxWidth: 360, margin: 'auto auto 0', paddingTop: 24, textAlign: 'center', fontSize: 12, lineHeight: 1.6, color: dark },
  lightText: { color: light },
  insetProbe: { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', paddingBottom: 'env(safe-area-inset-bottom, 0px)' },
});
