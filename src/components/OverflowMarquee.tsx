import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

interface OverflowMarqueeProps {
  text: string;
  className: string;
  trackClassName: string;
  durationVariable: "--hifi-title-marquee-duration" | "--ambient-title-marquee-duration";
  minDuration: number;
  maxDuration: number;
}

export function OverflowMarquee({
  text,
  className,
  trackClassName,
  durationVariable,
  minDuration,
  maxDuration
}: OverflowMarqueeProps) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateOverflow = () => {
      const title = viewport.firstElementChild?.firstElementChild as HTMLElement | null;
      setIsOverflowing((title?.scrollWidth ?? 0) > viewport.clientWidth + 1);
    };

    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [text]);

  const style = isOverflowing
    ? ({ [durationVariable]: `${Math.max(minDuration, Math.min(maxDuration, Math.ceil(text.length * 0.5)))}s` } as CSSProperties)
    : undefined;

  return (
    <span className={className} ref={viewportRef}>
      <span className={`${trackClassName} ${isOverflowing ? "is-scrolling" : "is-static"}`} style={style}>
        <span>{text}</span>
        {isOverflowing ? <span aria-hidden="true">{text}</span> : null}
      </span>
    </span>
  );
}
