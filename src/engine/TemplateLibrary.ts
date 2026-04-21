export const TEMPLATE_HINTS: Record<string, string> = {
  landing: `Build with: hero section (full viewport, dark background, gold accents, animated headline), product showcase grid with real images, countdown timer for drops, testimonials section, navbar with scroll effect, footer. Use Next.js 14, Framer Motion for all animations, Tailwind CSS, Playfair Display + Space Grotesk fonts. Dark editorial style — think Kith.com, SSENSE, luxury brand aesthetics. Gold accent #d4af37. Heavy animations: word-by-word text reveal, spring card hovers, stagger children on scroll.`,

  saas: `Build with: landing page (hero, features, pricing, CTA, footer), auth pages (login, signup, forgot password), dashboard with sidebar, settings page. Use Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui components.`,

  web3: `Build with: wallet connect button (rainbow kit or ethers.js), NFT display grid, transaction history, smart contract interaction panel. Use Next.js, wagmi, viem, Tailwind CSS.`,

  "3d-landing": `Build with: React Three Fiber 3D hero scene with floating geometric shapes, particle system, scroll-based animations using @react-three/drei. Include GSAP for smooth transitions.`,

  ecommerce: `Build with: product listing with filters, product detail page, shopping cart with localStorage, checkout form, order confirmation. Use Next.js, Tailwind CSS, Zustand for state.`,

  dashboard: `Build with: sidebar navigation, top stats cards, line chart, bar chart, data table with sorting/filtering, dark mode toggle. Use recharts, shadcn/ui, Next.js.`,

  portfolio: `Build with: hero with animated text, about section, skills grid, project cards with hover effects, contact form. Use Next.js, Framer Motion, Tailwind CSS.`,

  "ai-tool": `Build with: chat interface like ChatGPT, message history, streaming text display, model selector, system prompt editor, token counter. Use Next.js, Tailwind CSS, Vercel AI SDK patterns.`,

  blog: `Build with: MDX support, post listing with tags, individual post page, table of contents, author bio, dark mode. Use Next.js 14, Contentlayer or gray-matter.`,
};

const KEYWORD_MAP: Record<string, string[]> = {
  saas: ["saas", "subscription", "startup", "landing", "pricing", "auth", "login", "signup"],
  web3: ["web3", "nft", "blockchain", "crypto", "wallet", "ethereum", "solana", "defi", "smart contract"],
  "3d-landing": ["3d", "three.js", "threejs", "three js", "fiber", "webgl", "3d landing", "immersive"],
  ecommerce: ["ecommerce", "shop", "store", "cart", "checkout", "product", "buy", "sell", "marketplace"],
  dashboard: ["dashboard", "admin", "analytics", "chart", "graph", "table", "reporting", "data visualization"],
  portfolio: ["portfolio", "personal", "resume", "cv", "showcase", "my work", "about me"],
  "ai-tool": ["ai", "chat", "chatbot", "gpt", "llm", "assistant", "copilot", "ai tool", "conversation"],
  blog: ["blog", "articles", "posts", "mdx", "cms", "content", "writing"],
  landing: ['landing', 'homepage', 'marketing', 'sneaker', 'shoe', 'brand',
    'luxury', 'gym', 'fitness', 'restaurant', 'hotel', 'agency',
    'fashion', 'apparel', 'sport', 'clothing', 'boutique']
};

export function detectTemplate(prompt: string): string {
  const lower = prompt.toLowerCase();

  const landingKeywords = ['sneaker', 'shoe', 'brand', 'luxury', 'fashion', 'apparel', 'gym', 'fitness', 'restaurant', 'hotel', 'agency', 'creative', 'portfolio', 'landing', 'editorial', 'gold', 'boutique', 'wearable']
  if (landingKeywords.some(w => lower.includes(w))) return 'landing'

  for (const [template, keywords] of Object.entries(KEYWORD_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return template;
      }
    }
  }

  return "saas";
}

export function getTemplateHint(template: string): string {
  return TEMPLATE_HINTS[template] ?? TEMPLATE_HINTS["saas"];
}
