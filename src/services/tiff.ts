import UTIF from "utif";

/**
 * Browsers cannot display TIFF, but TIFF is the native fax format (CCITT G3/G4,
 * often multi-page). Decode every page to a PNG blob URL so the preview and the
 * vision pipeline can treat it like any other image.
 */

export function isTiffFile(file: File): boolean {
  return /^image\/tiff?$/i.test(file.type) || /\.tiff?$/i.test(file.name);
}

export async function tiffToPageUrls(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw new Error(`${file.name}: no pages found in TIFF`);

  const urls: string[] = [];
  for (const ifd of ifds) {
    UTIF.decodeImage(buffer, ifd, ifds);
    if (!ifd.width || !ifd.height) continue;
    const rgba = UTIF.toRGBA8(ifd);
    const canvas = document.createElement("canvas");
    canvas.width = ifd.width;
    canvas.height = ifd.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height), 0, 0);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error(`${file.name}: could not render a TIFF page`);
    urls.push(URL.createObjectURL(blob));
  }
  if (!urls.length) throw new Error(`${file.name}: TIFF contained no readable pages`);
  return urls;
}
