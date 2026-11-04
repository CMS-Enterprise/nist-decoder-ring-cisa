// Side-effect import declarations for non-TS module types.
//
// TypeScript 6 enabled `noUncheckedSideEffectImports`, which requires
// type declarations for any import statement that has no specifiers
// (i.e. `import "./foo.css"`). CSS imports have no runtime TS surface
// — the bundler (Next.js + Turbopack/Webpack) handles them — so we
// declare the modules as untyped here.

declare module "*.css";
