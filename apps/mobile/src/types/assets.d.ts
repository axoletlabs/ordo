/**
 * Metro treats bundled font files as asset modules (registry number on
 * native, URL on web). Declared so assets/fonts can be loaded with plain
 * ESM imports and passed to `Font.loadAsync`.
 */
declare module "*.ttf" {
  const asset: number;
  export default asset;
}

declare module "*.otf" {
  const asset: number;
  export default asset;
}
