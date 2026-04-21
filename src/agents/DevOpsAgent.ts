import { streamFromLLM } from "../engine/NetworkNode";
import { ProjectPlan } from "./PlannerAgent";
import type { DevOpsContext } from '../engine/AgentContext';

const DEVOPS_SYSTEM_PROMPT = `You are the DevOps Agent, a senior DevOps and deployment engineer.
Generate these deployment files as zozo_action XML blocks:

1. Dockerfile:
   FROM node:20-alpine AS deps
   WORKDIR /app
   COPY package.json package-lock.json* ./
   RUN npm ci --only=production

   FROM node:20-alpine AS builder
   WORKDIR /app
   COPY --from=deps /app/node_modules ./node_modules
   COPY . .
   ENV NEXT_TELEMETRY_DISABLED 1
   RUN npm run build

   FROM node:20-alpine AS runner
   WORKDIR /app
   ENV NODE_ENV production
   ENV NEXT_TELEMETRY_DISABLED 1
   RUN addgroup --system --gid 1001 nodejs
   RUN adduser --system --uid 1001 nextjs
   COPY --from=builder /app/public ./public
   COPY --from=builder /app/.next/standalone ./
   COPY --from=builder /app/.next/static ./.next/static
   USER nextjs
   EXPOSE 3000
   ENV PORT 3000
   ENV HOSTNAME "0.0.0.0"
   CMD ["node", "server.js"]

2. docker-compose.yml:
   version: '3.8'
   services:
     app:
       build: .
       ports: ["3000:3000"]
       env_file: .env
       depends_on: [db]
       restart: unless-stopped
     db:
       image: postgres:16-alpine
       environment:
         POSTGRES_USER: zozo
         POSTGRES_PASSWORD: \${DB_PASSWORD}
         POSTGRES_DB: zozo_db
       volumes: [pgdata:/var/lib/postgresql/data]
       ports: ["5432:5432"]
   volumes:
     pgdata:

3. .github/workflows/deploy.yml:
   name: Deploy
   on:
     push:
       branches: [main]
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 20
             cache: npm
         - run: npm ci
         - run: npm run lint
         - run: npm run build
         - uses: amondnet/vercel-action@v25
           with:
             vercel-token: \${{ secrets.VERCEL_TOKEN }}
             vercel-org-id: \${{ secrets.VERCEL_ORG_ID }}
             vercel-project-id: \${{ secrets.VERCEL_PROJECT_ID }}
             vercel-args: --prod

4. vercel.json:
   {
     "buildCommand": "npm run build",
     "outputDirectory": ".next",
     "framework": "nextjs",
     "regions": ["iad1"],
     "headers": [
       { "source": "/(.*)", "headers": [
         { "key": "X-Frame-Options", "value": "DENY" },
         { "key": "X-Content-Type-Options", "value": "nosniff" }
       ]}
     ]
   }

5. .gitignore:
   node_modules/
   .next/
   out/
   dist/
   build/
   .env
   .env.local
   .env.*.local
   *.log
   npm-debug.log*
   .DS_Store
   *.tsbuildinfo
   .vercel

6. scripts/setup.sh:
   #!/bin/bash
   echo "🚀 Setting up project..."
   npm install
   if [ ! -f .env ]; then
     cp .env.example .env
     echo "📄 Created .env from .env.example — fill in your values"
   fi
   echo "✅ Setup complete! Run: npm run dev"

Output ALL files as zozo_action XML blocks. Make them production-ready.`;

export async function runDevOpsAgent(
  plan: ProjectPlan,
  provider: string,
  apiKey: string
): Promise<string> {
  const userMessage = `Generate deployment and CI/CD configuration files for this application.

PROJECT: ${plan.projectName}
FRAMEWORK: ${plan.framework}
TECH STACK: ${plan.techStack.join(", ")}
TERMINAL COMMANDS: ${plan.terminalCommands.join(", ")}

Generate all DevOps files as zozo_action XML blocks now.`;

  try {
    const response = await streamFromLLM(userMessage, provider, apiKey, DEVOPS_SYSTEM_PROMPT);
    return response;
  } catch {
    // DevOps files are non-critical
    return "";
  }
}

/**
 * Context-aware variant of runDevOpsAgent.
 */
export async function runDevOpsAgentWithContext(
  ctx: DevOpsContext,
  plan: ProjectPlan
): Promise<string> {
  return runDevOpsAgent(plan, ctx.provider, ctx.apiKey);
}
