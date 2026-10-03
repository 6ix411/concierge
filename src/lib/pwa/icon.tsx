import { ImageResponse } from "next/og";

/** Brand colours for the app icon (the dark theme's background and gold accent). */
export const ICON_BACKGROUND = "#12141a";
const GOLD = "#d4a855";

/**
 * The app icon: a gold "C" on the dark brand colour. `maskable` keeps the mark inside the middle
 * 80% so Android can crop it to any shape.
 */
export function appIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  const mark = Math.round(size * (maskable ? 0.5 : 0.62));
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: ICON_BACKGROUND,
        borderRadius: maskable ? 0 : Math.round(size * 0.22),
      }}
    >
      <div
        style={{
          display: "flex",
          color: GOLD,
          fontSize: mark,
          fontWeight: 700,
          lineHeight: 1,
          marginTop: -Math.round(mark * 0.08),
        }}
      >
        C
      </div>
    </div>,
    { width: size, height: size },
  );
}
