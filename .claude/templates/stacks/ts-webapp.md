# Stack: TypeScript Web App

Opinionated stack for building production-ready web applications.

## Tools

| Layer | Tool | Docs |
|-------|------|------|
| Runtime | Bun | [bun.md](../tools/typescript/bun.md) |
| Framework | Next.js | [nextjs.md](../tools/typescript/nextjs.md) |
| Validation | Zod | [zod.md](../tools/typescript/zod.md) |
| UI Components | shadcn/ui + Tailwind | [shadcn-ui.md](../tools/typescript/shadcn-ui.md) |
| Forms | React Hook Form | [react-hook-form.md](../tools/typescript/react-hook-form.md) |
| Data Fetching | TanStack Query | [tanstack-query.md](../tools/typescript/tanstack-query.md) |
| State | Zustand | [zustand.md](../tools/typescript/zustand.md) |
| API Client | Hono RPC | [hono-rpc.md](../tools/typescript/hono-rpc.md) |
| Real-time | Convex | [convex.md](../tools/typescript/convex.md) |
| AI/LLM | Vercel AI SDK | [vercel-ai-sdk.md](../tools/typescript/vercel-ai-sdk.md) |
| Linting | Biome | [biome.md](../tools/typescript/biome.md) |
| Unit Testing | Bun Test | [bun-test.md](../tools/typescript/bun-test.md) |
| E2E Testing | Playwright | [playwright.md](../tools/playwright.md) |
| Monitoring | Highlight.io | [highlight-io.md](../tools/highlight-io.md) |
| Deployment | Vercel | [vercel.md](../tools/vercel.md) |
| Git Hooks | Husky | [husky.md](../tools/typescript/husky.md) |
| Secrets | Gitleaks | [gitleaks.md](../tools/gitleaks.md) |
| Deps Audit | bun audit | [audit.md](../tools/audit.md) |

## Quick Start

```bash
# Create Next.js project
bunx create-next-app@latest my-app --typescript --tailwind --app --src-dir
cd my-app

# Core dependencies
bun add @tanstack/react-query zustand zod @hookform/resolvers react-hook-form
bun add @highlight-run/react
bun add ai @ai-sdk/openai

# Dev dependencies
bun add -d @biomejs/biome husky lint-staged @playwright/test
bun add -d @tanstack/react-query-devtools

# Initialize tools
bunx biome init
bunx husky init
bunx shadcn@latest init
bunx playwright install

# Add shadcn components
bunx shadcn@latest add button input form dialog toast table
```

## Project Structure

```
my-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx       # Root layout with providers
│   │   ├── page.tsx
│   │   ├── providers.tsx    # Query/Highlight providers
│   │   ├── api/
│   │   │   └── chat/
│   │   │       └── route.ts # AI chat endpoint
│   │   └── users/
│   │       └── page.tsx
│   ├── components/
│   │   ├── ui/              # shadcn components
│   │   └── users/
│   │       ├── user-form.tsx
│   │       └── user-table.tsx
│   ├── hooks/
│   │   ├── use-users.ts     # TanStack Query hooks
│   │   └── use-chat.ts
│   ├── stores/
│   │   └── user-store.ts    # Zustand stores
│   ├── lib/
│   │   ├── api-client.ts    # Hono RPC client
│   │   ├── query-client.ts  # TanStack Query setup
│   │   ├── config.ts
│   │   └── utils.ts
│   └── schemas/
│       └── user.ts          # Zod schemas
├── e2e/
│   ├── home.spec.ts
│   └── users.spec.ts
├── biome.json
├── playwright.config.ts
├── next.config.ts
├── components.json          # shadcn config
├── package.json
└── .husky/
```

## Configuration Files

### package.json

```json
{
  "name": "my-app",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "test": "bun test",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "lint": "biome check . && next lint",
    "lint:fix": "biome check --fix .",
    "typecheck": "tsc --noEmit",
    "check": "bun run lint && bun run typecheck && bun test",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json}": ["biome check --fix"]
  }
}
```

### playwright.config.ts

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

## Core Files

### src/app/providers.tsx

```typescript
"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HighlightInit } from "@highlight-run/react";
import { queryClient } from "@/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HighlightInit
        projectId={process.env.NEXT_PUBLIC_HIGHLIGHT_PROJECT_ID!}
        serviceName="my-app"
        tracingOrigins
        networkRecording={{ enabled: true, recordHeadersAndBody: true }}
      />
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </>
  );
}
```

### src/app/layout.tsx

```typescript
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/toaster";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
```

### src/lib/api-client.ts

```typescript
import { hc } from "hono/client";
import type { AppType } from "@my-api/index"; // Import from your API

export const api = hc<AppType>(process.env.NEXT_PUBLIC_API_URL!);
```

### src/lib/query-client.ts

```typescript
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
```

### src/hooks/use-users.ts

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await api.api.users.$get();
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { email: string; name: string }) => {
      const res = await api.api.users.$post({ json: data });
      if (!res.ok) throw new Error("Failed to create user");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}
```

### src/stores/user-store.ts

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UserState {
  currentUser: User | null;
  setUser: (user: User | null) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      currentUser: null,
      setUser: (user) => set({ currentUser: user }),
    }),
    { name: "user-storage" }
  )
);
```

### src/components/users/user-form.tsx

```typescript
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useCreateUser } from "@/hooks/use-users";
import { useToast } from "@/components/ui/use-toast";

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export function UserForm() {
  const { toast } = useToast();
  const createUser = useCreateUser();
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", name: "" },
  });

  const onSubmit = (data: z.infer<typeof schema>) => {
    createUser.mutate(data, {
      onSuccess: (user) => {
        toast({ title: "Success", description: `Created ${user.name}` });
        form.reset();
      },
      onError: (error) => {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      },
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={createUser.isPending}>
          {createUser.isPending ? "Creating..." : "Create User"}
        </Button>
      </form>
    </Form>
  );
}
```

### src/app/api/chat/route.ts

```typescript
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages,
  });

  return result.toDataStreamResponse();
}
```

## Git Hooks

### .husky/pre-commit

```bash
#!/bin/sh
gitleaks protect --staged --verbose
bunx lint-staged
```

### .husky/pre-push

```bash
#!/bin/sh
bun audit
bun test
bun run typecheck
bun run build
```

## Testing

### Unit Tests (Bun Test)

```typescript
// src/hooks/use-users.test.ts
import { describe, it, expect, mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { useUsers } from "./use-users";

describe("useUsers", () => {
  it("fetches users", async () => {
    // Test implementation
  });
});
```

### E2E Tests (Playwright)

```typescript
// e2e/users.spec.ts
import { test, expect } from "@playwright/test";

test("creates a new user", async ({ page }) => {
  await page.goto("/users");

  await page.getByLabel("Email").fill("test@example.com");
  await page.getByLabel("Name").fill("Test User");
  await page.getByRole("button", { name: "Create User" }).click();

  await expect(page.getByText("Success")).toBeVisible();
  await expect(page.getByText("Test User")).toBeVisible();
});
```

## Import Strategy

**No barrel files.** Direct imports only:

```typescript
// ❌ Bad
import { Button, Input } from "@/components";

// ✅ Good
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
```

## Scripts

```bash
bun run dev          # Start with turbopack
bun run build        # Build for production
bun test             # Run unit tests
bun run test:e2e     # Run Playwright tests
bun run test:e2e:ui  # Playwright UI mode
bun run lint:fix     # Fix lint issues
bun run check        # Full quality check
```

## Security Checklist

- [ ] Security headers in next.config.ts
- [ ] Gitleaks in pre-commit
- [ ] `bun audit` in pre-push
- [ ] Zod validation on all inputs
- [ ] `NEXT_PUBLIC_` prefix only for public env vars
- [ ] CSRF protection for mutations
- [ ] Highlight.io tracking errors with session context
- [ ] API keys never exposed to client
