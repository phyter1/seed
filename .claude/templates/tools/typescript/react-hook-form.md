# Tool: React Hook Form

Performant forms with Zod validation.

## Install

```bash
bun add react-hook-form @hookform/resolvers zod
```

## Why React Hook Form

- **Performance**: Minimal re-renders via uncontrolled inputs
- **Zod integration**: First-class schema validation
- **TypeScript**: Full type inference from schemas
- **Small bundle**: ~10KB gzipped

## Configuration

No global config needed. Setup is per-form.

## Key Patterns

### Basic Form with Zod

```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormData = z.infer<typeof schema>;

export function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    await login(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("email")} placeholder="Email" />
      {errors.email && <span>{errors.email.message}</span>}

      <input {...register("password")} type="password" placeholder="Password" />
      {errors.password && <span>{errors.password.message}</span>}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Loading..." : "Login"}
      </button>
    </form>
  );
}
```

### With Default Values

```typescript
const { register, handleSubmit } = useForm<FormData>({
  resolver: zodResolver(schema),
  defaultValues: {
    email: user?.email ?? "",
    name: user?.name ?? "",
  },
});
```

### Server-Side Errors

```typescript
const {
  register,
  handleSubmit,
  setError,
  formState: { errors },
} = useForm<FormData>({
  resolver: zodResolver(schema),
});

const onSubmit = async (data: FormData) => {
  const result = await api.users.$post({ json: data });

  if (!result.ok) {
    const error = await result.json();
    // Set server error on specific field
    setError("email", { message: error.message });
    // Or set root error
    setError("root", { message: "Something went wrong" });
    return;
  }
};
```

### Controlled Components (Select, Checkbox)

```typescript
import { Controller } from "react-hook-form";

const schema = z.object({
  role: z.enum(["admin", "user"]),
  terms: z.boolean().refine((v) => v, "You must accept terms"),
});

function Form() {
  const { control, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Controller
        name="role"
        control={control}
        render={({ field }) => (
          <select {...field}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        )}
      />

      <Controller
        name="terms"
        control={control}
        render={({ field }) => (
          <label>
            <input type="checkbox" checked={field.value} onChange={field.onChange} />
            Accept terms
          </label>
        )}
      />
    </form>
  );
}
```

### With shadcn/ui

```typescript
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={form.formState.isSubmitting}>
          Login
        </Button>
      </form>
    </Form>
  );
}
```

### File Upload

```typescript
const schema = z.object({
  avatar: z.instanceof(FileList).refine((f) => f.length > 0, "Required"),
});

function Form() {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: z.infer<typeof schema>) => {
    const file = data.avatar[0];
    const formData = new FormData();
    formData.append("file", file);
    await uploadFile(formData);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input type="file" {...register("avatar")} />
    </form>
  );
}
```

## Gotchas

- Use `Controller` for custom/controlled components
- `register` returns `ref`, `name`, `onChange`, `onBlur` - spread them all
- `isSubmitting` stays true until `onSubmit` promise resolves
- Reset form with `reset()` after successful submission

## Pairs With

- [Zod](./zod.md) via `@hookform/resolvers`
- [shadcn/ui](./shadcn-ui.md) form components
- [Hono RPC](./hono-rpc.md) for type-safe API calls
