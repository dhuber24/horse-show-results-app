// A slot needs a default for a load its pages cannot match. Every page is
// matched by `page.tsx` or `[...path]/page.tsx`, so this is only what a 404
// renders: no sidebar.
export default function SidebarDefault() {
  return null;
}
