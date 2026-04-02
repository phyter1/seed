# Tool: Zustand

Minimal, unopinionated state management.

## Install

```bash
bun add zustand
```

## Why Zustand

- **Simple API**: No boilerplate, no providers
- **TypeScript-first**: Full type inference
- **Tiny**: ~1KB gzipped
- **React 18 ready**: Concurrent rendering compatible
- **Middleware**: Persist, devtools, immer out of the box

## Key Patterns

### Basic Store

```typescript
// src/stores/user-store.ts
import { create } from "zustand";

interface UserState {
  user: User | null;
  setUser: (user: User | null) => void;
  logout: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  logout: () => set({ user: null }),
}));
```

```typescript
// Usage in component
function Profile() {
  const user = useUserStore((state) => state.user);
  const logout = useUserStore((state) => state.logout);

  if (!user) return <LoginButton />;

  return (
    <div>
      <p>{user.name}</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### Async Actions

```typescript
interface UserState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  fetchUser: (id: string) => Promise<void>;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  isLoading: false,
  error: null,
  fetchUser: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.users[":id"].$get({ param: { id } });
      if (!res.ok) throw new Error("Failed to fetch user");
      const user = await res.json();
      set({ user, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
}));
```

### Persist to LocalStorage

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ThemeState {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "light",
      setTheme: (theme) => set({ theme }),
    }),
    { name: "theme-storage" }
  )
);
```

### Immer for Nested Updates

```typescript
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

interface TodoState {
  todos: Todo[];
  addTodo: (todo: Todo) => void;
  toggleTodo: (id: string) => void;
}

export const useTodoStore = create<TodoState>()(
  immer((set) => ({
    todos: [],
    addTodo: (todo) =>
      set((state) => {
        state.todos.push(todo);
      }),
    toggleTodo: (id) =>
      set((state) => {
        const todo = state.todos.find((t) => t.id === id);
        if (todo) todo.completed = !todo.completed;
      }),
  }))
);
```

### Devtools

```typescript
import { create } from "zustand";
import { devtools } from "zustand/middleware";

export const useCountStore = create<CountState>()(
  devtools(
    (set) => ({
      count: 0,
      increment: () => set((state) => ({ count: state.count + 1 }), false, "increment"),
      decrement: () => set((state) => ({ count: state.count - 1 }), false, "decrement"),
    }),
    { name: "CountStore" }
  )
);
```

### Selectors (Performance)

```typescript
// ❌ Bad - re-renders on ANY state change
const { user, todos, settings } = useStore();

// ✅ Good - only re-renders when user changes
const user = useStore((state) => state.user);

// ✅ Multiple values with shallow compare
import { shallow } from "zustand/shallow";

const { user, isLoading } = useStore(
  (state) => ({ user: state.user, isLoading: state.isLoading }),
  shallow
);
```

### Store Slices (Large Apps)

```typescript
// src/stores/slices/user-slice.ts
export interface UserSlice {
  user: User | null;
  setUser: (user: User | null) => void;
}

export const createUserSlice = (set: SetState<UserSlice>): UserSlice => ({
  user: null,
  setUser: (user) => set({ user }),
});

// src/stores/slices/cart-slice.ts
export interface CartSlice {
  items: CartItem[];
  addItem: (item: CartItem) => void;
}

export const createCartSlice = (set: SetState<CartSlice>): CartSlice => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
});

// src/stores/index.ts
import { create } from "zustand";

type AppState = UserSlice & CartSlice;

export const useStore = create<AppState>()((...a) => ({
  ...createUserSlice(...a),
  ...createCartSlice(...a),
}));
```

## Gotchas

- Always use selectors to avoid unnecessary re-renders
- `set` merges state shallowly by default (use `immer` for deep updates)
- Stores are singletons - state persists between component mounts
- Use `persist` middleware for state that survives page refresh

## Pairs With

- [TanStack Query](./tanstack-query.md) for server state (Zustand for client state)
- [Immer](https://immerjs.github.io/immer/) for complex state updates
- React DevTools via `devtools` middleware
