import { useEffect, useRef, useState } from "react";

export default function BrandIntro() {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const closing = useRef(false);
  const hideTimer = useRef<number | null>(null);

  function finish() {
    if (closing.current) return;
    closing.current = true;
    setLeaving(true);
    hideTimer.current = window.setTimeout(() => setVisible(false), 360);
  }

  useEffect(() => {
    const fallback = window.setTimeout(finish, 3000);
    return () => {
      window.clearTimeout(fallback);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <button type="button" className={`brand-intro${leaving ? " leaving" : ""}`} onClick={finish} aria-label="Пропустить заставку PresentKlein">
      <video
        className="brand-intro-video"
        src="/brand-intro.mp4"
        poster="/brand-intro-poster.png"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
        aria-hidden="true"
      />
      <div className="brand-intro-caption" aria-hidden="true">
        <b>PresentKlein</b>
      </div>
      <div className="brand-intro-progress" aria-hidden="true"><i /></div>
    </button>
  );
}
