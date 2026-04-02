# Tool: Next.js

React framework for production. Server components, routing, and full-stack capabilities.

## Install

```bash
# Create new project
bunx create-next-app@latest my-app
# or
npx create-next-app@latest my-app

# Add to existing project
bun add next react react-dom
```

## Why Next.js

- **Full-stack** - API routes, server components, server actions
- **Performance** - Automatic code splitting, image optimization
- **Developer experience** - Fast refresh, TypeScript support
- **Deployment** - Vercel, self-hosted, Docker

## Quick Start

```bash
bunx create-next-app@latest my-app --typescript --tailwind --eslint --app --src-dir
cd my-app
bun dev
```

## Project Structure

```
src/
  app/
    layout.tsx        # Root layout
    page.tsx          # Home page
    api/
      route.ts        # API routes
    users/
      page.tsx        # /users page
      [id]/
        page.tsx      # /users/:id page
  components/
  lib/
```

## App Router Patterns

### Pages

```typescript
// src/app/page.tsx
export default function Home() {
  return <h1>Home</h1>;
}

// src/app/users/page.tsx
export default async function UsersPage() {
  const users = await getUsers(); // Server component - runs on server
  return <UserList users={users} />;
}
```

### API Routes

```typescript
// src/app/api/users/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const users = await db.users.findMany();
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const user = await db.users.create({ data: body });
  return NextResponse.json(user, { status: 201 });
}
```

### Server Actions

```typescript
// src/app/actions.ts
"use server";

export async function createUser(formData: FormData) {
  const name = formData.get("name") as string;
  await db.users.create({ data: { name } });
  revalidatePath("/users");
}

// src/app/users/page.tsx
import { createUser } from "./actions";

export default function UsersPage() {
  return (
    <form action={createUser}>
      <input name="name" />
      <button type="submit">Create</button>
    </form>
  );
}
```

## Configuration

```typescript
// next.config.ts
import type { NextConfig } from "next";

const config: NextConfig = {
  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
```

## Scripts

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

## Testing

```typescript
// Use Vitest + React Testing Library
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders heading", () => {
    render(<Home />);
    expect(screen.getByRole("heading")).toHaveTextContent("Home");
  });
});
```

## Gotchas

1. **Client vs Server** - Default is server. Add `"use client"` for client components.
2. **No barrel exports** - Direct imports only. Barrel files kill performance.
3. **Caching** - Aggressive by default. Use `revalidatePath` or `cache: 'no-store'`.
4. **Environment variables** - Prefix with `NEXT_PUBLIC_` for client-side access.

## Pairs With

- [bun.md](./bun.md) - Runtime
- [zod.md](./zod.md) - Validation
- [vitest.md](./vitest.md) - Testing
- [biome.md](./biome.md) - Linting
