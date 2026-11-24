import { useEffect, useState, type RefObject } from "react";

/**
 * Кнопка быстрой прокрутки наверх для длинных списков.
 *
 * Работает и с окном (страница профиля), и с собственным скролл-контейнером
 * (экран кейса, шторка выбора подарка): передайте ref контейнера.
 * Появляется, когда список прокручен вниз, и плавно возвращает к началу.
 */
export default function QuickScroll({
  containerRef,
  label = "Наверх",
}: {
  containerRef?: RefObject<HTMLElement | null>;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef?.current;
    const target: HTMLElement | Window = el ?? window;

    const read = () => (el ? el.scrollTop : window.scrollY || document.documentElement.scrollTop);
    const onScroll = () => setVisible(read() > 320);

    onScroll();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [containerRef]);

  function toTop() {
    const el = containerRef?.current;
    if (el) {
      el.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <button
      type="button"
      className={`quick-top${visible ? " show" : ""}`}
      onClick={toTop}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      aria-label={label}
    >
      <span aria-hidden="true">↑</span>
      <small>{label}</small>
    </button>
  );
}
