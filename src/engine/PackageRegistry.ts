/**
 * PackageRegistry
 *
 * Curated, version-locked package list for the ZOZO stack.
 * Covers Next.js 15 + React 19 + Tailwind 3 + TypeScript 5.
 *
 * Every entry has:
 * - exact npm name (prevents hallucination of wrong names)
 * - locked compatible version (prevents version conflicts)
 * - correct import syntax (prevents wrong import paths)
 * - what it exports (prevents hallucinated prop/API names)
 */

export interface PackageEntry {
  npmName: string          // Exact npm install name
  version: string          // Version to pin (semver range)
  importSyntax: string[]   // Exact import examples — copy-paste ready
  exports: string[]        // Key exports — prevents hallucination
  category: PackageCategory
  requiresSetup?: string   // If package needs config file
  shadcnComponent?: boolean // True if it's a shadcn/ui component (path-based, not npm)
}

export type PackageCategory =
  | 'ui-components'
  | 'animation'
  | 'forms'
  | 'data-fetching'
  | 'database'
  | 'auth'
  | 'payments'
  | 'utilities'
  | 'styling'
  | 'state'
  | 'icons'

export const PACKAGE_REGISTRY: PackageEntry[] = [
  // ── ANIMATION ────────────────────────────────────────────────────────────
  {
    npmName: 'framer-motion',
    version: '^11.0.0',
    importSyntax: [
      `import { motion, AnimatePresence, useAnimation, useInView } from 'framer-motion'`,
    ],
    exports: ['motion', 'AnimatePresence', 'useAnimation', 'useInView', 'useMotionValue', 'useTransform'],
    category: 'animation',
  },

  // ── ICONS ────────────────────────────────────────────────────────────────
  {
    npmName: 'lucide-react',
    version: '^0.400.0',
    importSyntax: [
      `import { ArrowRight, Check, X, ChevronDown, Menu, Star, Zap } from 'lucide-react'`,
    ],
    exports: ['ArrowRight', 'Check', 'X', 'ChevronDown', 'Menu', 'Star', 'Zap', 'Github', 'Twitter'],
    category: 'icons',
  },

  // ── STYLING UTILITIES ────────────────────────────────────────────────────
  {
    npmName: 'clsx',
    version: '^2.1.0',
    importSyntax: [`import { clsx, type ClassValue } from 'clsx'`],
    exports: ['clsx', 'ClassValue'],
    category: 'styling',
  },
  {
    npmName: 'tailwind-merge',
    version: '^2.2.0',
    importSyntax: [`import { twMerge } from 'tailwind-merge'`],
    exports: ['twMerge'],
    category: 'styling',
  },
  {
    npmName: 'class-variance-authority',
    version: '^0.7.0',
    importSyntax: [`import { cva, type VariantProps } from 'class-variance-authority'`],
    exports: ['cva', 'VariantProps'],
    category: 'styling',
  },

  // ── FORMS ────────────────────────────────────────────────────────────────
  {
    npmName: 'react-hook-form',
    version: '^7.51.0',
    importSyntax: [
      `import { useForm, Controller, FormProvider } from 'react-hook-form'`,
    ],
    exports: ['useForm', 'Controller', 'FormProvider', 'useFormContext', 'useWatch'],
    category: 'forms',
  },
  {
    npmName: '@hookform/resolvers',
    version: '^3.3.0',
    importSyntax: [`import { zodResolver } from '@hookform/resolvers/zod'`],
    exports: ['zodResolver', 'yupResolver'],
    category: 'forms',
  },
  {
    npmName: 'zod',
    version: '^3.23.0',
    importSyntax: [`import { z } from 'zod'`],
    exports: ['z'],
    category: 'forms',
  },

  // ── DATA FETCHING ────────────────────────────────────────────────────────
  {
    npmName: 'swr',
    version: '^2.2.0',
    importSyntax: [`import useSWR from 'swr'`],
    exports: ['default (useSWR)', 'SWRConfig', 'mutate'],
    category: 'data-fetching',
  },
  {
    npmName: '@tanstack/react-query',
    version: '^5.28.0',
    importSyntax: [
      `import { useQuery, useMutation, QueryClient, QueryClientProvider } from '@tanstack/react-query'`,
    ],
    exports: ['useQuery', 'useMutation', 'QueryClient', 'QueryClientProvider', 'useQueryClient'],
    category: 'data-fetching',
  },

  // ── DATABASE ──────────────────────────────────────────────────────────────
  {
    npmName: '@supabase/supabase-js',
    version: '^2.43.0',
    importSyntax: [`import { createClient } from '@supabase/supabase-js'`],
    exports: ['createClient', 'SupabaseClient'],
    category: 'database',
    requiresSetup: 'Create lib/supabase.ts with createClient(url, key)',
  },
  {
    npmName: '@supabase/ssr',
    version: '^0.3.0',
    importSyntax: [
      `import { createBrowserClient } from '@supabase/ssr'`,
      `import { createServerClient } from '@supabase/ssr'`,
    ],
    exports: ['createBrowserClient', 'createServerClient'],
    category: 'database',
  },
  {
    npmName: 'prisma',
    version: '^5.14.0',
    importSyntax: [`// CLI only: npx prisma generate`],
    exports: ['CLI tool'],
    category: 'database',
    requiresSetup: 'Create prisma/schema.prisma',
  },
  {
    npmName: '@prisma/client',
    version: '^5.14.0',
    importSyntax: [`import { PrismaClient } from '@prisma/client'`],
    exports: ['PrismaClient'],
    category: 'database',
  },

  // ── AUTH ──────────────────────────────────────────────────────────────────
  {
    npmName: 'next-auth',
    version: '^4.24.0',
    importSyntax: [
      `import NextAuth from 'next-auth'`,
      `import { getServerSession } from 'next-auth'`,
      `import { useSession, signIn, signOut } from 'next-auth/react'`,
    ],
    exports: ['default (NextAuth)', 'getServerSession', 'useSession', 'signIn', 'signOut'],
    category: 'auth',
    requiresSetup: 'Create app/api/auth/[...nextauth]/route.ts',
  },
  {
    npmName: '@clerk/nextjs',
    version: '^5.1.0',
    importSyntax: [
      `import { ClerkProvider, useUser, useAuth, SignInButton, UserButton } from '@clerk/nextjs'`,
      `import { auth, currentUser } from '@clerk/nextjs/server'`,
    ],
    exports: ['ClerkProvider', 'useUser', 'useAuth', 'SignInButton', 'UserButton', 'auth', 'currentUser'],
    category: 'auth',
    requiresSetup: 'Add ClerkProvider to layout.tsx, create middleware.ts',
  },

  // ── PAYMENTS ──────────────────────────────────────────────────────────────
  {
    npmName: 'stripe',
    version: '^15.7.0',
    importSyntax: [`import Stripe from 'stripe'`],
    exports: ['default (Stripe class)'],
    category: 'payments',
    requiresSetup: 'Server-only: const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)',
  },
  {
    npmName: '@stripe/stripe-js',
    version: '^3.4.0',
    importSyntax: [`import { loadStripe } from '@stripe/stripe-js'`],
    exports: ['loadStripe'],
    category: 'payments',
  },
  {
    npmName: '@stripe/react-stripe-js',
    version: '^2.7.0',
    importSyntax: [
      `import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'`,
    ],
    exports: ['Elements', 'PaymentElement', 'useStripe', 'useElements'],
    category: 'payments',
  },

  // ── STATE MANAGEMENT ─────────────────────────────────────────────────────
  {
    npmName: 'zustand',
    version: '^4.5.0',
    importSyntax: [`import { create } from 'zustand'`],
    exports: ['create'],
    category: 'state',
  },

  // ── UTILITIES ────────────────────────────────────────────────────────────
  {
    npmName: 'next-themes',
    version: '^0.3.0',
    importSyntax: [
      `import { ThemeProvider, useTheme } from 'next-themes'`,
    ],
    exports: ['ThemeProvider', 'useTheme'],
    category: 'utilities',
  },
  {
    npmName: 'sonner',
    version: '^1.4.0',
    importSyntax: [
      `import { Toaster, toast } from 'sonner'`,
    ],
    exports: ['Toaster', 'toast'],
    category: 'utilities',
  },
  {
    npmName: 'date-fns',
    version: '^3.6.0',
    importSyntax: [`import { format, formatDistanceToNow, parseISO } from 'date-fns'`],
    exports: ['format', 'formatDistanceToNow', 'parseISO', 'addDays', 'subDays'],
    category: 'utilities',
  },
  {
    npmName: 'recharts',
    version: '^2.12.0',
    importSyntax: [
      `import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'`,
    ],
    exports: ['LineChart', 'Line', 'BarChart', 'Bar', 'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'ResponsiveContainer', 'PieChart', 'Pie'],
    category: 'utilities',
  },
]

// shadcn/ui components — NOT npm packages
// Import via path: @/components/ui/[name]
// BuilderAgent MUST NEVER use 'shadcn-ui' or '@shadcn/ui' as npm package names
export const SHADCN_COMPONENTS: Record<string, string> = {
  'Button':    `import { Button } from '@/components/ui/button'`,
  'Card':      `import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'`,
  'Input':     `import { Input } from '@/components/ui/input'`,
  'Label':     `import { Label } from '@/components/ui/label'`,
  'Badge':     `import { Badge } from '@/components/ui/badge'`,
  'Dialog':    `import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'`,
  'Sheet':     `import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'`,
  'Tabs':      `import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'`,
  'Select':    `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'`,
  'Switch':    `import { Switch } from '@/components/ui/switch'`,
  'Checkbox':  `import { Checkbox } from '@/components/ui/checkbox'`,
  'Textarea':  `import { Textarea } from '@/components/ui/textarea'`,
  'Separator': `import { Separator } from '@/components/ui/separator'`,
  'Avatar':    `import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'`,
  'Dropdown':  `import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'`,
  'Progress':  `import { Progress } from '@/components/ui/progress'`,
  'Skeleton':  `import { Skeleton } from '@/components/ui/skeleton'`,
  'Toast':     `import { useToast } from '@/components/ui/use-toast'`,
  'Tooltip':   `import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'`,
  'Table':     `import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'`,
}

// Forbidden hallucinations — packages that DO NOT EXIST
// BuilderAgent is explicitly told these are wrong
export const FORBIDDEN_PACKAGES = [
  'shadcn-ui',           // wrong — use @/components/ui/[name]
  '@shadcn/ui',          // wrong — use @/components/ui/[name]
  '@next/font',          // merged into next.js core — use: import { Inter } from 'next/font/google'
  'tailwind-ui',         // wrong — not a real package
  '@tailwind/ui',        // wrong
  'headlessui',          // wrong — use @headlessui/react
  'radix-ui',            // wrong — use @radix-ui/react-[name]
  'heroicons',           // wrong — use @heroicons/react
  'framer',              // wrong — use framer-motion
  'motion',              // wrong — use framer-motion
  '@framer/motion',      // wrong
  'next-auth/next',      // wrong path
  '@supabase/auth-js',   // wrong — use @supabase/supabase-js
  'supabase-js',         // wrong
  'stripe-js',           // wrong — use @stripe/stripe-js
  'react-query',         // old name — use @tanstack/react-query
  'react-icons/all',     // wrong path
  'tailwindcss-animate', // wrong — tailwindcss-animate is ok but often misused
]

export class PackageRegistry {

  /**
   * Returns the constraint prompt block for BuilderAgent.
   * This is injected into every build — cannot be compacted away.
   */
  toConstraintPrompt(requestedPackages?: string[]): string {
    // If specific packages are known (from PlannerAgent), filter to relevant ones
    const relevant = requestedPackages
      ? PACKAGE_REGISTRY.filter(p =>
          requestedPackages.some(r => p.npmName.includes(r) || r.includes(p.npmName.split('/').pop() ?? ''))
        )
      : PACKAGE_REGISTRY

    const lines = [
      `## PACKAGE CONSTRAINTS — read before writing a single import`,
      ``,
      `### CRITICAL: shadcn/ui is NOT an npm package`,
      `NEVER write: import { Button } from 'shadcn-ui' ❌`,
      `NEVER write: import { Button } from '@shadcn/ui' ❌`,
      `ALWAYS write: import { Button } from '@/components/ui/button' ✅`,
      ``,
      `### shadcn/ui component imports (exact paths):`,
      ...Object.values(SHADCN_COMPONENTS).slice(0, 8).map(imp => `  ${imp}`),
      ``,
      `### FORBIDDEN packages (these do not exist — never use them):`,
      FORBIDDEN_PACKAGES.map(p => `  ❌ ${p}`).join('\n'),
      ``,
      `### ALLOWED packages with exact import syntax:`,
    ]

    const byCategory = new Map<PackageCategory, PackageEntry[]>()
    for (const pkg of relevant.slice(0, 12)) {
      const list = byCategory.get(pkg.category) ?? []
      list.push(pkg)
      byCategory.set(pkg.category, list)
    }

    for (const [category, pkgs] of byCategory) {
      lines.push(``)
      lines.push(`**${category}:**`)
      for (const pkg of pkgs) {
        lines.push(`  ${pkg.npmName}@${pkg.version}`)
        for (const syntax of pkg.importSyntax.slice(0, 1)) {
          lines.push(`    ${syntax}`)
        }
        if (pkg.requiresSetup) {
          lines.push(`    ⚠ Setup: ${pkg.requiresSetup}`)
        }
      }
    }

    lines.push(``)
    lines.push(`### Dependency versions (use EXACTLY these — never "latest"):`)
    for (const pkg of relevant.slice(0, 10)) {
      lines.push(`  "${pkg.npmName}": "${pkg.version}"`)
    }
    lines.push(``)
    lines.push(`DO NOT install any package not in this list without explicit instruction.`)
    lines.push(`DO NOT use "latest" as a version — use the exact version shown above.`)

    return lines.join('\n')
  }

  /**
   * Given a list of npm package names, return correct versions.
   * Used by DependencyReconciler to pin exact versions instead of "latest".
   */
  getVersion(packageName: string): string | null {
    const entry = PACKAGE_REGISTRY.find(p => p.npmName === packageName)
    return entry?.version ?? null
  }

  /**
   * Check if an import is from a forbidden package.
   */
  isForbidden(importPath: string): boolean {
    const pkgName = importPath.startsWith('@')
      ? importPath.split('/').slice(0, 2).join('/')
      : importPath.split('/')[0] ?? ''
    return FORBIDDEN_PACKAGES.includes(pkgName)
  }
}
