import type { Metadata } from 'next'

// Override the page's <link rel="manifest"> while the user is anywhere
// under /recipes. When the family hits Safari's "Add to Home Screen"
// or Chrome's "Install app" while on /recipes, the phone picks up
// /recipes.webmanifest instead of the main vault manifest and installs
// what looks like a separate "Cobb Recipes" app — own name, own icon,
// own start_url (/recipes). No new codebase, no Play Store, no TWA.
//
// Family install flow:
//   iOS Safari:  open /recipes → Share → Add to Home Screen → name it "Recipes"
//   Android Chrome: open /recipes → menu → Install app
//
// scope stays at "/" so the PWA doesn't break when the family clicks
// through to /meal-plan or back to /notes from a recipe.
export const metadata: Metadata = {
  manifest: '/recipes.webmanifest',
  title: 'Cobb Recipes',
  appleWebApp: {
    capable: true,
    title: 'Recipes',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    // Override the parent layout's apple-touch icon while on /recipes
    // so iOS "Add to Home Screen" picks up the recipe-specific artwork
    // instead of the main CV icon.
    apple: [
      { url: '/icons/cobb/recipes-pwa-apple-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export default function RecipesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
