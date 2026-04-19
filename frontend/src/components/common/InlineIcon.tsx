import { colorizedSvg } from "../dag/nodeIcons";

export default function InlineIcon({ type, size = 14, color }: { type: string; size?: number; color?: string }) {
  const svg = colorizedSvg(type, color);
  if (!svg) return null;
  const sized = svg.replace(/width="[^"]*"/, `width="${size}"`).replace(/height="[^"]*"/, `height="${size}"`);
  return <span style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", verticalAlign: "middle" }} dangerouslySetInnerHTML={{ __html: sized }} />;
}
