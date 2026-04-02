# Tool: TanStack Query

Server state management with caching, background updates, and optimistic UI.

## Install

```bash
bun add @tanstack/react-query
```

## Why TanStack Query

- **Automatic caching**: No manual cache management
- **Background refetching**: Data stays fresh
- **Optimistic updates**: Instant UI feedback
- **DevTools**: Debug cache state visually
- **TypeScript-first**: Full type inference

## Configuration

### src/lib/query-client.ts

```typescript
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
```

### src/app/providers.tsx

```typescript
"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "@/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

## Key Patterns

### Basic Query

```typescript
import { useQuery } from "@tanstack/react-query";
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

// Usage
function UsersList() {
  const { data: users, isLoading, error } = useUsers();

  if (isLoading) return <Loading />;
  if (error) return <Error message={error.message} />;

  return users.map((user) => <UserCard key={user.id} user={user} />);
}
```

### Query with Parameters

```typescript
export function useUser(id: string) {
  return useQuery({
    queryKey: ["users", id],
    queryFn: async () => {
      const res = await api.api.users[":id"].$get({ param: { id } });
      if (!res.ok) throw new Error("User not found");
      return res.json();
    },
    enabled: !!id, // Don't run if no id
  });
}
```

### Mutations

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { email: string; name: string }) => {
      const res = await api.api.users.$post({ json: data });
      if (!res.ok) throw new Error("Failed to create user");
      return res.json();
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

// Usage
function CreateUserForm() {
  const createUser = useCreateUser();

  const onSubmit = (data: FormData) => {
    createUser.mutate(data, {
      onSuccess: (user) => {
        toast.success(`Created ${user.name}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* form fields */}
      <button disabled={createUser.isPending}>
        {createUser.isPending ? "Creating..." : "Create"}
      </button>
    </form>
  );
}
```

### Optimistic Updates

```typescript
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<User> }) => {
      const res = await api.api.users[":id"].$patch({ param: { id }, json: data });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["users", id] });

      // Snapshot previous value
      const previousUser = queryClient.getQueryData<User>(["users", id]);

      // Optimistically update
      queryClient.setQueryData<User>(["users", id], (old) =>
        old ? { ...old, ...data } : old
      );

      return { previousUser };
    },
    onError: (err, { id }, context) => {
      // Rollback on error
      queryClient.setQueryData(["users", id], context?.previousUser);
    },
    onSettled: (_, __, { id }) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ["users", id] });
    },
  });
}
```

### Infinite Queries (Pagination)

```typescript
import { useInfiniteQuery } from "@tanstack/react-query";

export function useInfiniteUsers() {
  return useInfiniteQuery({
    queryKey: ["users", "infinite"],
    queryFn: async ({ pageParam = 0 }) => {
      const res = await api.api.users.$get({
        query: { offset: pageParam, limit: 20 },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === 20 ? allPages.length * 20 : undefined;
    },
    initialPageParam: 0,
  });
}

// Usage
function UsersList() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteUsers();

  return (
    <>
      {data?.pages.flat().map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
      {hasNextPage && (
        <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Loading..." : "Load More"}
        </button>
      )}
    </>
  );
}
```

### Prefetching

```typescript
// Prefetch on hover
function UserLink({ id }: { id: string }) {
  const queryClient = useQueryClient();

  const prefetchUser = () => {
    queryClient.prefetchQuery({
      queryKey: ["users", id],
      queryFn: () => fetchUser(id),
    });
  };

  return (
    <Link href={`/users/${id}`} onMouseEnter={prefetchUser}>
      View User
    </Link>
  );
}
```

## Query Key Conventions

```typescript
// Entity list
["users"]

// Entity by ID
["users", userId]

// Entity with filters
["users", { status: "active", role: "admin" }]

// Nested resources
["users", userId, "posts"]
["users", userId, "posts", postId]
```

## Gotchas

- Always return/throw from `queryFn` - don't just check `res.ok`
- Query keys must be serializable (no functions)
- `gcTime` (garbage collection) replaced `cacheTime` in v5
- Use `enabled` to conditionally run queries
- DevTools only in development by default

## Pairs With

- [Hono RPC](./hono-rpc.md) for type-safe API calls
- [Zustand](./zustand.md) for client-only state
- [React Hook Form](./react-hook-form.md) for form mutations
