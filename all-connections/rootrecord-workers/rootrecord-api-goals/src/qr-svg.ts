import { renderSVG } from "uqr";

export function qrSvgForAddress(address: string): string {
  const data = String(address || "").trim();
  if (!data) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#f4f1ea"/></svg>`;
  }
  return renderSVG(data, {
    ecc: "M",
    border: 2,
    pixelSize: 8,
    whiteColor: "#f4f1ea",
    blackColor: "#080c10",
  });
}
