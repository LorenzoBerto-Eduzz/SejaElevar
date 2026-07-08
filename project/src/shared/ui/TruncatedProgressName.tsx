import { useLayoutEffect, useRef, useState } from 'react';

type TruncatedProgressNameProps = {
  children: string;
};

export function TruncatedProgressName({ children }: TruncatedProgressNameProps) {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const textElement = textRef.current;
    const wrapElement = textElement?.parentElement;

    if (!textElement || !wrapElement) {
      return;
    }

    let animationFrameId: number | null = null;
    const measure = () => {
      animationFrameId = null;
      setIsTruncated(textElement.scrollWidth > textElement.clientWidth + 1);
    };
    const scheduleMeasure = () => {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleMeasure);

    resizeObserver?.observe(wrapElement);
    window.addEventListener('resize', scheduleMeasure);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [children]);

  return (
    <span
      className={
        isTruncated
          ? 'row-details-progress-name-wrap can-expand'
          : 'row-details-progress-name-wrap'
      }
    >
      <span className="row-details-progress-name" ref={textRef}>
        {children}
      </span>
    </span>
  );
}
