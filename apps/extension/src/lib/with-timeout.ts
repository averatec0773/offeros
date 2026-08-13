/**
 * A wait that always ends.
 *
 * The panel spends its life waiting on things it does not control: a background
 * worker, a permission prompt, a page. Any of them can decline to answer at all
 * — not fail, not reject, simply never come back — and a promise that never
 * settles takes the button with it. That is how "Starting…" became permanent on
 * a real click: the flow behind it had no exit, so neither did the UI.
 *
 * The timeout resolves rather than throwing, because every caller here has
 * something honest to say when the answer never came, and an exception would
 * make them say it in a catch block that also swallows real errors.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(onTimeout());
    }, ms);
    const settle = (value: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    work.then(settle, () => settle(onTimeout()));
  });
}
