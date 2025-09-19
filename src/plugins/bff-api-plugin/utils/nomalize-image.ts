// utils/normalizeMedia.ts
type StrapiImage = {
  url?: string | null;
  alternativeText?: string | null;
  [key: string]: any; // остальные поля нам не важны
};

export function normalizeImage(image: StrapiImage | null | undefined) {
  if (!image) return null;

  return {
    url: image.url || null,
    alt: image.alternativeText || null,
  };
}
