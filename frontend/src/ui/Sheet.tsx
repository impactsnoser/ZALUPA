import { useEffect, type ReactNode } from "react";
import { Glyph } from "./Icons";

export default function Sheet({
  title,
  onClose,
  locked,
  children,
  tall,
}: {
  title: string;
  onClose: () => void;
  locked?: boolean;
  children: ReactNode;
  tall?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !locked && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={() => !locked && onClose()}>
      <div
        className={`sheet${tall ? " tall" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} disabled={locked} aria-label="Закрыть">
            <Glyph name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
